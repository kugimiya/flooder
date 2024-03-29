import { AbstractCrawler } from './AbstractCrawler';
import { Storage } from '../Storage';
import axios, { AxiosError } from 'axios';
import { LibRuGetBookText, LibRuGetDOM, LibRuGetLinksInDOM } from '../utils/libRuParserHelpers';
import { sleep } from '../utils/sleep';
import { createHash } from 'crypto';
import { readFile, writeFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { config } from '../config';

// Ссылки из общей навигации и прочее
const BLACKLIST_URLS = [
  'PROZA/',
  'INPROZ/',
  'POEZIQ/',
  'RUFANT/',
  'RUSS_DETEKTIW/',
  'HISTORY/',
  'What-s-new',
  'HITPARAD/',
  'Forum/',
  'Mirrors',
  '.dir_StripDir.html',
];

const CATEGORY_URLS = [
  'http://lib.ru/CULTURE/',
  'http://lib.ru/FILOSOF/',
  'http://lib.ru/URIKOVA/',
  'http://lib.ru/URIKOVA/SANTEM/',
  'http://lib.ru/ASTROLOGY/',
  'http://lib.ru/RELIGION/',
  'http://lib.ru/DIALEKTIKA/',
  'http://lib.ru/POLITOLOG/',
  'http://lib.ru/PSIHO/',
  'http://lib.ru/NLP/',
  'http://lib.ru/DPEOPLE/',
  'http://lib.ru/NTL/ECONOMY/',
  'http://lib.ru/NTL/KIBERNETIKA/',
  'http://lib.ru/NTL/ECOLOGY/',
  'http://lib.ru/NTL/AKUSTIKA/',
  'http://lib.ru/NTL/ASTRONOMY/',
  'http://lib.ru/NTL/CHEMISTRY/',
  'http://lib.ru/NTL/STROIT/',
  'http://lib.ru/NTL/TECH/',
  'http://lib.ru/NTL/STANDARTY/',
  'http://lib.ru/NTL/ARTICLES/',
  'http://lib.ru/RUSS_DETEKTIW/',
  'http://lib.ru/DETEKTIWY/',
  'http://lib.ru/HISTORY/',
  'http://lib.ru/MEMUARY/',
  'http://lib.ru/INOSTRHIST/',
  'http://lib.ru/HIST/',
  'http://lib.ru/RUFANT/',
  'http://lib.ru/INOFANT/',
  'http://lib.ru/TALES/',
  'http://lib.ru/PRIKL/',
  'http://lib.ru/POEEAST/',
  'http://lib.ru/INOOLD/',
  'http://lib.ru/PROZA/',
  'http://lib.ru/RUSSLIT/',
  'http://lib.ru/LITRA/',
  'http://lib.ru/SU/',
  'http://lib.ru/PXESY/',
  'http://lib.ru/NEWPROZA/',
  'http://lib.ru/INPROZ/',
];

export class CrawlerLibRu implements AbstractCrawler {
  storage: Storage;
  name = 'lib.ru';
  isReady = false;
  isReCallable = false;
  breakTime = 7500;
  authorsUrls: string[] = [];
  booksUrls: string[] = [];

  counter = {
    fetched: 0,
    time: 0,
  };

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async init(): Promise<void> {
    let fileReaden = false;
    console.log(`Crawler [${this.name}]: Start creating authors list`);

    try {
      const { booksUrls, authorsUrls } = JSON.parse((await readFile(config.crawler.libru.cachedUrlsPath)).toString());
      this.booksUrls = booksUrls;
      this.authorsUrls = authorsUrls;

      fileReaden = true;
    } catch {
      console.log(`Crawler [${this.name}]: Cache file read failed, starting online fetch`);
    }

    if (!fileReaden) {
      for (let catUrl of CATEGORY_URLS) {
        try {
          const links = (await this.getAuthorsUrlsByCategory(catUrl))
            .filter(link => {
              if (link.includes('.txt') && !link.includes('.txt_Content')) {
                this.booksUrls.push(link);
                return false;
              }

              return true;
            });
          this.authorsUrls = [...this.authorsUrls, ...links];
        } catch (e) {
          console.log(`Crawler [${this.name}]: Getting authors links failed: ${e}`);

          if ((e as AxiosError).message.includes('503')) {
            console.log(`Crawler [${this.name}]: Gonna sleep for 15 minutes, cause its ban`);
            await sleep(15 * 60 * 1000);
          }
        } finally {
          await sleep(this.breakTime);
        }
      }

      this.authorsUrls = [...new Set(this.authorsUrls)];
    }

    if (!fileReaden || this.booksUrls.length === 0) {
      for (const authorUrl of this.authorsUrls) {
        console.log(`Crawler [${this.name}]: Processing link ${this.authorsUrls.findIndex((_) => _ === authorUrl) + 1} of ${this.authorsUrls.length}`);

        try {
          const links = await this.getBooksUrlsByAuthor(authorUrl);
          this.booksUrls = [...this.booksUrls, ...links];
        } catch (e) {
          console.log(`Crawler [${this.name}]: Getting books links failed: ${e}`);

          if ((e as AxiosError).message.includes('503')) {
            console.log(`Crawler [${this.name}]: Gonna sleep for 15 minutes, cause its ban`);
            await sleep(15 * 60 * 1000);
          }
        } finally {
          await sleep(this.breakTime);
        }
      }

      this.booksUrls = [...new Set(this.booksUrls)];
      await writeFile(config.crawler.libru.cachedUrlsPath, JSON.stringify({ booksUrls: this.booksUrls, authorsUrls: this.authorsUrls }, null, 2));
    }

    console.log(`Crawler [${this.name}]: Authors links found: ${this.authorsUrls.length}`);
    console.log(`Crawler [${this.name}]: Books links found: ${this.booksUrls.length}`);

    this.isReady = true;
  }

  private async getBooksUrlsByAuthor(authorUrl: string): Promise<string[]> {
    console.log(`Crawler [${this.name}]: Getting books list for ${authorUrl.replace('http://lib.ru/', '')} [delay ${this.breakTime}ms]`);

    const raw = await axios.get<string>(authorUrl, {
      responseType: 'arraybuffer',
      responseEncoding: 'binary',
    });
    const dom = LibRuGetDOM(raw.data);
    const booksList = LibRuGetLinksInDOM(dom)
      .map(link => link.includes('.txt') ? link : '')
      .filter(link => link !== '')
      .filter(link => !link.includes('.txt_Contents'))
      .map((link) => `${authorUrl}/${link}`);

    console.log(`Crawler [${this.name}]: found ${booksList.length} links for ${authorUrl.replace('http://lib.ru/', '')}`);
    return booksList;
  }

  private async getAuthorsUrlsByCategory(categoryUrl: string): Promise<string[]> {
    console.log(`Crawler [${this.name}]: Getting authors list for ${categoryUrl.replace('http://lib.ru/', '')} [delay ${this.breakTime}ms]`);

    const raw = await axios.get<string>(categoryUrl, {
      responseType: 'arraybuffer',
      responseEncoding: 'binary',
    });
    const dom = LibRuGetDOM(raw.data);
    const authorsLinks = LibRuGetLinksInDOM(dom)
      .map(link => link.replace('/', ''))
      .map(link => link.startsWith('..') ? '' : link)
      .map(link => link.startsWith('koi/') ? '' : link)
      .map(link => link.startsWith('win/') ? '' : link)
      .map(link => link.startsWith('lat/') ? '' : link)
      .map(link => link.includes('.txt_Contents') ? '' : link)
      .map(link => BLACKLIST_URLS.includes(link) ? '' : link)
      .filter(link => link !== '')
      .map((link) => `${categoryUrl}${link}`);

    console.log(`Crawler [${this.name}]: found ${authorsLinks.length} links for ${categoryUrl}`);
    return authorsLinks;
  }

  async getNext(): Promise<{ text: string; nextAvailable: boolean; id?: string; shouldSkipDelay?: boolean }> {
    const link = this.booksUrls.pop() || '';
    const id = createHash('sha256').update(link).digest('hex');
    const startTime = Date.now();
    const linkFsEd = link.replace('http://lib.ru/', '').split('/').join('_').split('../').join('');
    const filePath = `${config.crawler.libru.corpusReservPath}/libru_${linkFsEd}_${id}.txt`;
    const filePathOld = `${config.crawler.libru.corpusReservPath}/libru_${id}.txt`;

    if (existsSync(filePath) || await this.storage.checkIsFetched(id)) {
      return {
        text: '',
        id,
        nextAvailable: this.booksUrls.length > 0,
        shouldSkipDelay: true,
      };
    }

    if (existsSync(filePathOld)) {
      console.log(`Crawler [${this.name}]: Found book in old-style path, moving in new-style (books in queue: ${this.booksUrls.length})`);
      const content = (await readFile(filePathOld)).toString();
      await writeFile(filePath, content);
      await rm(filePathOld);

      return {
        text: '',
        id,
        nextAvailable: this.booksUrls.length > 0,
      };
    }

    try {
      console.log(`Crawler [${this.name}]: Getting book ${link.replace('http://lib.ru/', '')} (books in queue: ${this.booksUrls.length})`);

      const { data } = await axios.get(link, {
        responseType: 'arraybuffer',
        responseEncoding: 'binary',
      });
      const dom = LibRuGetDOM(data);
      const text = LibRuGetBookText(dom);

      await this.storage.addFetched(id);
      await writeFile(filePath, text);

      const time = Date.now() - startTime;
      this.counter.fetched += 1;
      this.counter.time += time + this.breakTime;

      const average = this.counter.time / this.counter.fetched;
      const speed = Math.round(((60 * 60 * 1000) / average) * 1000) / 1000;
      const speedDay = Math.round(((24 * 60 * 60 * 1000) / average) * 1000) / 1000;

      console.log(`Crawler [${this.name}]: Fetched for ${time}ms, avg: ${average}ms, spd: ${speed} per hour (or ${speedDay} per day)`)

      return {
        text,
        id,
        nextAvailable: this.booksUrls.length > 0,
      };
    } catch (e) {
      console.log(`Crawler [${this.name}]: Error fetching book ${link.replace('http://lib.ru/', '')}: ${e}`);

      if ((e as AxiosError).message.includes('503')) {
        console.log(`Crawler [${this.name}]: Gonna sleep for 15 minutes, cause its ban`);
        await sleep(15 * 60 * 1000);
      }

      return {
        text: '',
        id,
        nextAvailable: this.booksUrls.length > 0,
      };
    }
  }
}

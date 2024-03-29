import { AbstractCrawler } from './AbstractCrawler';
import { Storage } from '../Storage';
import axios from 'axios';
import { sleep } from '../utils/sleep';
import { createHash } from 'crypto';
import { writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { config } from '../config';

type UmechanResponse<T> = {
  payload: T;
  version: string;
  error: null | string;
};

type UmechanPost = {
  id: number;
  truncated_message: string;
};

type GetAllResponse = UmechanResponse<{
  posts: UmechanPost[];
  count: number;
}>;

type ThreadResponse = UmechanResponse<{
  thread_data: {
    replies: UmechanPost[];
  };
}>;

export class CrawlerUmechan implements AbstractCrawler {
  storage: Storage;
  name = 'umechan';
  isReady = false;
  isReCallable = false;
  breakTime = 500;

  threadsIds: number[] = [];

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async init(): Promise<void> {
    console.log(`Crawler [${this.name}]: Fetching all threads`);

    let nextPageAvailable = true;
    let page = 0;

    while (nextPageAvailable) {
      try {
        const { data } = await axios.get<GetAllResponse>(
          config.crawler.umechan.getAllLink,
          {
            params: {
              limit: config.crawler.umechan.pageSize,
              offset: page * config.crawler.umechan.pageSize
            }
          }
        );

        console.log(`Crawler [${this.name}]: For page ${page} fetched ${data.payload?.posts?.length} threads [delay ${this.breakTime}ms]`);

        if (data.error !== null) {
          console.log(`Crawler [${this.name}]: error getting all posts: ${data.error}`);
          continue;
        }

        nextPageAvailable = data.payload?.posts?.length > 0;

        (data.payload?.posts || []).forEach(post => {
          this.threadsIds.push(post.id);
        });
      } catch (e) {
        console.log(`Crawler [${this.name}]: error getting all posts: ${e}`);
      } finally {
        page += 1;
        await sleep(this.breakTime);
      }

      if (page > config.crawler.umechan.maxPageThreshold) {
        nextPageAvailable = false;
      }
    }

    this.isReady = true;
  }

  async getNext(): Promise<{ text: string; nextAvailable: boolean; id?: string; shouldSkipDelay?: boolean }> {
    const threadId = this.threadsIds.pop();

    if (!threadId) {
      return {
        text: '',
        nextAvailable: this.threadsIds.length > 0,
      };
    }

    const url = `${config.crawler.umechan.baseUrl}/post/${threadId}`;
    const id = createHash('sha256').update(url).digest('hex');

    console.log(`Crawler [${this.name}]: getting thread #${threadId}`);

    if (existsSync(path.resolve(config.crawler.umechan.corpusReservPath, `umechan_${id}.txt`)) || await this.storage.checkIsFetched(id)) {
      return {
        text: '',
        id,
        nextAvailable: this.threadsIds.length > 0,
        shouldSkipDelay: true,
      }
    }

    try {
      const { data } = await axios.get<ThreadResponse>(url);

      if (data.error !== null) {
        console.log(`Crawler [${this.name}]: error getting thread #${threadId}: ${data.error}`);
        return {
          text: '',
          id,
          nextAvailable: this.threadsIds.length > 0,
        };
      }

      const text = [
        ...new Set(
          (data.payload?.thread_data?.replies || [])
            .map((post) => post.truncated_message)
            .join('\n')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 1)
            .filter(line => !line.startsWith('>>'))
        )
      ].join('\n');

      console.log(`Crawler [${this.name}]: for thread #${threadId} found ${data.payload?.thread_data?.replies?.length} posts`);

      await writeFile(path.resolve(config.crawler.umechan.corpusReservPath, `umechan_${id}.txt`), text);

      return {
        text,
        id,
        nextAvailable: this.threadsIds.length > 0,
      };
    } catch (e) {
      console.log(`Crawler ${this.name}: error getting all posts: ${e}`);
    }

    return {
      text: '',
      id,
      nextAvailable: this.threadsIds.length > 0,
    };
  }
}

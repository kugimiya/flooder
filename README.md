## U-Me-Chan :: flooder
Шутка, чтобы обхитрить Хому

## Установка
```shell
git clone https://github.com/U-Me-Chan/flooder.git && \
cd flooder && \
yarn install --frozen-lockfile
```

## Запуск
```shell
yarn start
```

## Куда класть свои *.txt с корпусами
В директорию `corpus`, там есть уже есть парочка txt-файлов. При старте сервис не будет их читать, только при запуске процесса кравлинга.

## API-endpoints
По-дефолту запускается и слушает на 3030 порту, http://localhost:3030/
```
- Генерирует текст:
  GET /
  
- Запускает процесс кравлинга:
  GET /crawler/run
  
- Сохраняет модель и прогресс кравлеров:
  GET /model/save

- Загружает модель:
  GET /model/load
```
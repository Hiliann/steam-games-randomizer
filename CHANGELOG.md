# Изменения

## 1.6.0

- В настройки добавлено создание ярлыка Play Next на рабочем столе.
- Добавлен фоновый запуск вместе с Windows без открытия браузера и без прав администратора.
- Ярлыки привязаны к текущей папке программы; выключение удаляет только ярлык этой копии.
- Добавлена фоновая и ручная проверка новых релизов на GitHub. Обновления не скачиваются и не устанавливаются автоматически.
- Добавлены проверки безопасности API, валидация ссылок релиза и тесты Windows-интеграции.

### English

- Added an option to create a Play Next desktop shortcut.
- Added background startup with Windows without opening the browser or requiring administrator rights.
- Shortcuts are tied to the current program folder; disabling an option removes only this copy's shortcut.
- Added background and manual checks for new GitHub releases. Updates are never downloaded or installed automatically.
- Added API security checks, release-link validation and Windows integration tests.

## 1.5.0

- Добавлены сохраняемые категории игр с назначением прямо из карточки.
- Категории можно использовать как фильтр библиотеки или отдельный режим случайного выбора.
- Добавлены режимы для установленных, неустановленных, ещё не запускавшихся и не запускавшихся 90 дней игр.
- Категории, история, текущий круг и выбранный режим теперь сохраняются в `data/profile.json` и не зависят от браузера или локального порта.
- Вероятность всех подходящих игр остаётся одинаковой. Статистика и изменение веса отдельных игр не добавлялись.
- Интерфейс категорий и новых фильтров адаптирован для узких окон и сенсорного управления.

### English

- Added saved game categories that can be assigned directly from each game card.
- Categories work as either a library filter or a randomization mode.
- Added modes for installed, uninstalled, never-played and 90-day dormant games.
- Categories, pick history, the current round and the selected mode are now stored in `data/profile.json`, independent of the browser and local port.
- Every eligible game keeps the same probability. Statistics and per-game probability weights were intentionally not added.
- Category management and the new filters adapt to narrow windows and touch input.

## 1.4.1

- Добавлены английское описание проекта и английская страница сайта с переключением RU/EN.
- Упрощены названия программы и архива. Длинные тире в пользовательских текстах заменены обычными дефисами.
- Игровая логика не менялась. При обновлении сохрани папку `data`.

### English

- Added an English project description and website with RU/EN navigation.
- Simplified the application and archive names, and replaced long dashes in user-facing text with ordinary hyphens.
- Game-selection behavior is unchanged. Keep your `data` folder when updating.

## 1.4.0

- Размер неустановленных игр подгружается из системных требований Steam Store. Это требуемое место на диске, не точный объём загрузки.
- Если источник недоступен, используются сохранённые сведения или приблизительная оценка из локального Steam. При отсутствии обоих источников размер не выдумывается.
- Размеры и плашку установленной игры можно включать и выключать. Настройки отображения и исключения сохраняются в папке `data`.
- В комплекте: установленная и локально лицензированная библиотека, выбор без повторов, поиск, история и адаптивный интерфейс.
- Программа для Windows 10/11 x64 включает Node.js 24.20.0. Установка среды и API-ключ не требуются.

Для обновления заверши приложение через Stop.cmd и сохрани свою папку `data`.

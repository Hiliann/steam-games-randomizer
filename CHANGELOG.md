# Изменения

## 1.8.0

- Добавлены русский и английский интерфейс с переключением без перезапуска.
- Добавлены темы «Тёмный лес», «Полночь» и «Графит», а также четыре акцентных цвета.
- Добавлена резервная копия категорий, истории, исключений, путей библиотек и настроек одним JSON-файлом.
- Восстановление проверяет весь файл до записи и возвращает прежние данные, если одна из записей завершилась ошибкой.
- Автоматическое обновление теперь запускается только при старте программы, если пользователь заранее включил галочку.
- Добавлено отдельное окно о новой версии с действиями «Установить», «Позже» и «Больше не показывать».
- Настройка обновлений старого формата переносится автоматически, а пользовательские данные по-прежнему не входят в архив обновления.

### English

- Added Russian and English interfaces with switching that does not require a restart.
- Added Dark Forest, Midnight and Graphite themes plus four accent colors.
- Added one-file backup for categories, history, exclusions, library paths and settings.
- Restore validates the entire file before writing and rolls previous data back if one write fails.
- Automatic updating now runs only at app startup when the user has enabled it beforehand.
- Added a separate new-version notice with Install, Later and Do not show again actions.
- Existing update preferences migrate automatically, while user data remains excluded from update archives.

## 1.7.0

- Категории теперь заполняются массово: выбери подборку, найди игры, отметь несколько и сохрани одним действием.
- Из карточки игры можно сразу открыть редактор и перейти к нужной игре.
- Кнопка запуска передаёт игру локальной программе, поэтому браузер больше не оставляет техническую вкладку `steam://`.
- Добавлена необязательная автоматическая установка проверенных обновлений.
- Обновление проверяет SHA-256 и манифест каждого файла, заменяет только файлы программы и никогда не изменяет папку `data`.
- Уведомления о новых версиях показываются независимо от настройки автоматической установки.

### English

- Categories now use a bulk workflow: choose a collection, search, select multiple games and save once.
- A game card can open the editor directly at that game.
- The play button delegates launching to the local program, so the browser no longer leaves a technical `steam://` tab behind.
- Added optional automatic installation of verified updates.
- Updates verify SHA-256 and a per-file manifest, replace program files only and never modify the `data` folder.
- New-version notifications remain available regardless of the automatic-install setting.

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

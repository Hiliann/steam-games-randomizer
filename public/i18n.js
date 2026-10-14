let language = 'ru';
let observer;
const textSources = new WeakMap();
const attributeSources = new WeakMap();
const listeners = new Set();

const exact = new Map([
  ['Восстанавливаем данные…', 'Restoring data…'],
  ['Слишком большой запрос.', 'The request is too large.'],
  ['Проверяем резервную копию. Данные пока не изменяются…', 'Checking backup. Your data has not been changed…'],
  ['Восстановление отменено. Данные не изменены.', 'Restore cancelled. Your data was not changed.'],
  ['Восстановление не подтверждено. Проверь данные перед повторной попыткой.', 'Restore was not confirmed. Check your data before trying again.'],
  ['Нет связи с приложением. Данные не изменены.', 'No connection to the app. Your data was not changed.'],
  ['Нет связи с приложением. Запусти его и повтори.', 'No connection to the app. Start it and try again.'],
  ['Некорректные локальные настройки библиотек.', 'Invalid local library settings.'],
  ['Не удалось создать резервную копию.', 'Could not create a backup.'],
  ['Не удалось проверить резервную копию.', 'Could not validate the backup.'],
  ['Не удалось восстановить резервную копию.', 'Could not restore the backup.'],
  ['Выбери файл резервной копии Play Next размером до 6 МБ.', 'Choose a Play Next backup file up to 6 MB.'],
  ['Файл не является корректной резервной копией JSON.', 'The file is not a valid JSON backup.'],
  ['В резервной копии повреждены настройки библиотек.', 'The backup contains invalid library settings.'],
  ['В резервной копии отсутствует часть данных.', 'The backup is missing some data.'],
  ['В резервной копии повреждены категории, история или исключения.', 'The backup contains invalid categories, history or exclusions.'],
  ['В резервной копии повреждены настройки программы.', 'The backup contains invalid application settings.'],
  ['Это не резервная копия Play Next или её формат не поддерживается.', 'This is not a Play Next backup, or its format is not supported.'],
  ['Сначала выбери и проверь файл резервной копии.', 'Choose and validate a backup file first.'],
  ['Приложение восстановило данные, но не вернуло настройки библиотек.', 'The app restored data but did not return the library settings.'],
  ['Восстановление прервано, а автоматический откат не завершился. Не закрывай программу и сохрани содержимое папки data.', 'Restore was interrupted and rollback could not finish. Do not close the app; preserve the contents of its data folder.'],
  ['Сохраняем изменения…', 'Saving changes…'], ['Подборка сохранена', 'Collection saved'],
  ['ВЫБИРАЕМ ИГРУ', 'PICKING A GAME'], ['Без категории', 'Uncategorized'],
  ['Параметры выбора', 'Pick options'],
  ['Доступна для установки', 'Available to install'], ['Перед запуском нужно обновление', 'Update required before launch'], ['Готова к запуску', 'Ready to play'],
  ['Не участвует в выборе', 'Excluded from picks'], ['Участвует в выборе', 'Included in picks'], ['Вернуть в выбор', 'Include in picks'], ['Исключить из выбора', 'Exclude from picks'],
  ['Подробнее об игре', 'Read more'], ['Свернуть описание', 'Show less'], ['Активные фильтры', 'Active filters'],
  ['Сохранить изменения подборки?', 'Save collection changes?'], ['Сохранить и продолжить', 'Save and continue'], ['Не сохранять', 'Discard changes'], ['Остаться', 'Stay here'],
  ['Ты изменил состав игр. Сохрани подборку перед переходом или продолжи без этих изменений.', 'You changed the games in this collection. Save before leaving, or continue without these changes.'],
  ['Не удалось подтвердить сохранение. Изменения оставлены на экране. Проверь связь с приложением.', 'Could not confirm the save. Your changes remain on screen. Check the app connection.'],
  ['Установка', 'Installation'], ['Любой статус', 'Any status'], ['Установленные', 'Installed'], ['Неустановленные', 'Not installed'],
  ['Очистить поиск', 'Clear search'], ['Участие игры восстановлено', 'Game participation restored'],
  ['Сбросить фильтры', 'Reset filters'],
  ['Проверяем библиотеку Steam', 'Checking your Steam library'],
  ['Обновить и играть', 'Update and play'], ['Закрыть описание', 'Close description'], ['Категории игры', 'Game categories'],
  ['Загрузка Play Next', 'Loading Play Next'], ['Твоя следующая игра уже рядом', 'Your next game is almost here'],
  ['Открываем твою библиотеку…', 'Opening your library…'], ['Скрыть загрузку', 'Hide loading screen'],
  ['Собираем твои игры…', 'Collecting your games…'], ['Загружаем категории и настройки…', 'Loading collections and settings…'],
  ['Сбрось поиск или выбери другой фильтр.', 'Clear the search or choose another filter.'],
  ['Включи «Показывать неустановленные игры» над списком, чтобы увидеть всю библиотеку Steam.', 'Enable “Show uninstalled games” above the list to see your entire Steam library.'],
  ['Игры в подборке', 'Games in collection'], ['Выбрать из подборки', 'Pick from collection'], ['Сначала сохрани изменения текущей подборки или нажми «Отменить».', 'Save the changes to this collection first, or click “Cancel”.'],
  ['Навигация приложения', 'Application navigation'], ['Основные разделы', 'Main sections'], ['Play Next - выбор игры', 'Play Next - choose a game'],
  ['Выбор игры', 'Choose a game'], ['Библиотека', 'Library'], ['Папки Steam', 'Steam folders'], ['Недавний выбор', 'Recent picks'],
  ['Найди следующую игру из своей библиотеки Steam.', 'Find your next game in your Steam library.'], ['Перечитать библиотеку Steam', 'Rescan your Steam library'],
  ['Все игры, поиск и управление участием в случайном выборе.', 'Browse your games and choose which ones can appear in a draw.'], ['Собери подборки для любого настроения.', 'Create collections for every mood.'],
  ['Настрой Play Next под себя. Изменения сохраняются автоматически.', 'Make Play Next yours. Changes are saved automatically.'],
  ['СЛУЧАЙНЫЙ ВЫБОР', 'RANDOM PICK'], ['Во что поиграть?', 'What to play?'], ['Выбери режим и нажми кнопку. Запустить игру можно сразу здесь.', 'Choose a mode and press the button. Launch the game right here.'],
  ['Здесь появятся выбранные игры. Нажми «Выбрать игру», чтобы начать.', 'Your picks will appear here. Press “Pick a game” to get started.'],
  ['Хочешь выбрать сам или изменить список участников?', 'Want to choose yourself or change the draw pool?'], ['Открыть библиотеку', 'Open library'], ['Все игры', 'All games'],
  ['Вид библиотеки', 'Library view'], ['Карточки', 'Cards'], ['Список', 'List'], ['Сортировка', 'Sort by'], ['По названию', 'Name'], ['По последнему запуску', 'Last played'], ['По размеру', 'Size'],
  ['Нажми на обложку, чтобы открыть игру. Галочка определяет участие в случайном выборе.', 'Click a cover to open the game. The checkbox controls participation in random picks.'],
  ['Настройки приложения', 'Application settings'], ['Разделы настроек', 'Settings sections'], ['Оформление', 'Appearance'], ['Игры', 'Games'], ['Мои данные', 'My data'], ['Информация об играх', 'Game information'],
  ['Окно приложения открывается свёрнутым', 'The application opens minimized'], ['Категории игр', 'Game categories'], ['Мои подборки', 'My collections'], ['Название подборки', 'Collection name'], ['Создать категорию', 'Create category'],
  ['Переименовать или удалить категории', 'Rename or delete categories'], ['ТВОЙ ВЫБОР', 'YOUR PICK'], ['ПРОСМОТР ИГРЫ', 'GAME PREVIEW'], ['НЕ УЧАСТВУЕТ В СЛУЧАЙНОМ ВЫБОРЕ', 'EXCLUDED FROM RANDOM PICKS'],
  ['ДОСТУПНА ДЛЯ УСТАНОВКИ', 'AVAILABLE TO INSTALL'], ['ГОТОВА К ЗАПУСКУ', 'READY TO PLAY'], ['Следующая игра - в один клик', 'Your next game is one click away'], ['Подключи библиотеку Steam', 'Connect your Steam library'],
  ['Нажми «Выбрать игру». Здесь появятся обложка, описание и кнопка запуска.', 'Press “Pick a game” to see its cover, description and launch button.'], ['Открой «Папки Steam» слева и укажи папку клиента или SteamLibrary.', 'Open “Steam folders” and select your Steam or SteamLibrary folder.'],
  ['Подключаемся…', 'Connecting…'], ['К библиотеке ↓', 'Go to library ↓'], ['Подключено локально', 'Connected locally'], ['Восстанавливаем связь…', 'Reconnecting…'],
  ['Связь прервалась. Восстанавливаем подключение. Твои данные сохранены.', 'Connection interrupted. Reconnecting. Your data is saved.'], ['Восстановить связь', 'Reconnect'],
  ['Связь прервалась. Приложение попробует восстановить её автоматически.', 'Connection interrupted. The app will try to reconnect automatically.'],
  ['Категории', 'Categories'], ['Библиотеки', 'Libraries'], ['Настройки', 'Settings'],
  ['Открыть категории игр', 'Open game categories'], ['Открыть библиотеки Steam', 'Open Steam libraries'], ['Открыть настройки отображения', 'Open settings'],
  ['МЕНЬШЕ ВЫБОРА. БОЛЬШЕ ИГРЫ.', 'LESS CHOOSING. MORE PLAYING.'], ['Во что играем сегодня', 'What are we playing today'], ['игр установлено', 'games installed'], ['Ищем библиотеки Steam…', 'Looking for Steam libraries…'],
  ['Браузер запретил сохранить настройки показа библиотеки. Категории, история, текущий круг и исключения сохраняются отдельно в папке приложения.', 'The browser could not save library view settings. Categories, history, the current round and exclusions are stored separately in the app folder.'],
  ['ТВОЯ СЛЕДУЮЩАЯ ИГРА', 'YOUR NEXT GAME'], ['Источник размера в Steam', 'Size source on Steam'], ['БИБЛИОТЕКА ПОЛНА ВОЗМОЖНОСТЕЙ', 'YOUR LIBRARY IS FULL OF POSSIBILITIES'],
  ['Вечер свободен.', 'The evening is free.'], ['Игра найдётся.', 'We will find a game.'], ['Собираем установленные игры из Steam…', 'Collecting installed Steam games…'], ['Играть в Steam', 'Play on Steam'], ['Установить в Steam', 'Install on Steam'], ['Не предлагать эту игру', 'Do not suggest this game'],
  ['ДОВЕРЬСЯ СЛУЧАЮ', 'TRUST THE DRAW'], ['Твоя библиотека.', 'Your library.'], ['Один счастливчик.', 'One lucky pick.'], ['Знакомая любимая или давно забытая -', 'A familiar favorite or a forgotten gem -'], ['пусть сегодня решит случай.', 'let chance decide today.'],
  ['Выбрать игру', 'Pick a game'], ['Предложить другую', 'Pick another'], ['или нажми', 'or press'], ['Пробел', 'Space'], ['Режим выбора', 'Selection mode'], ['Сузь выбор без изменения шансов', 'Narrow the pool without changing the odds'], ['Без повторов', 'No repeats'], ['Все игры получат свой шанс', 'Every game gets its turn'], ['В этом круге ещё не было игр', 'No games drawn in this round yet'], ['Сбросить круг', 'Reset round'], ['Прогресс текущего круга', 'Current round progress'], ['Проверяем, что уже установлено.', 'Checking what is already installed.'],
  ['Недавно выпадали', 'Recent picks'], ['Очистить историю', 'Clear history'], ['Здесь появятся твои находки. Первый ход за тобой.', 'Your discoveries will appear here. Make the first pick.'],
  ['ВСЁ УЖЕ НА ТВОЁМ КОМПЬЮТЕРЕ', 'ALREADY ON YOUR COMPUTER'], ['НА КОМПЬЮТЕРЕ И В ТВОЁМ STEAM', 'ON YOUR COMPUTER AND IN YOUR STEAM LIBRARY'], ['Твоя библиотека', 'Your library'], ['Обновить список', 'Refresh list'], ['Показывать неустановленные игры', 'Show uninstalled games'], ['Они тоже будут участвовать в случайном выборе', 'They will also take part in the random draw'], ['Сейчас выбираем только из установленных игр.', 'Currently drawing from installed games only.'],
  ['«Место» - объём по требованиям в Steam Store, не размер скачивания. Подгружается из интернета по мере просмотра карточек. «≈» - запасная оценка из локального Steam.', '“Disk space” is the publisher requirement from Steam Store, not download size. It loads from the internet as cards appear. “≈” is a fallback estimate from local Steam data.'],
  ['Фильтр библиотеки', 'Library filter'], ['Участвуют', 'Included'], ['Все', 'All'], ['Исключены', 'Excluded'], ['Фильтр по категории', 'Filter by category'], ['Все категории', 'All categories'], ['Найти игру…', 'Find a game…'], ['Поиск по названию игры', 'Search by game title'], ['Убери галочку под игрой, чтобы она не участвовала в розыгрыше. Категории можно использовать как фильтр или отдельный режим выбора.', 'Clear the checkbox under a game to exclude it from the draw. Categories can be used as a filter or a separate selection mode.'], ['Поиск и фильтр библиотеки не меняют список для розыгрыша', 'Search and library filters do not change the draw pool'],
  ['Игры пока не найдены', 'No games found yet'], ['Добавь папку Steam или SteamLibrary в настройках библиотек.', 'Add a Steam or SteamLibrary folder in library settings.'], ['Указать папку', 'Choose folder'], ['Читаем данные Steam…', 'Reading Steam data…'], ['Загружаем исключения…', 'Loading exclusions…'],
  ['Укажи папку Steam или SteamLibrary. Сейчас учитываем только установки на диске.', 'Add a Steam or SteamLibrary folder. Only installed games are currently included.'],
  ['Сделай паузу. Запусти игру.', 'Take a break. Start a game.'], ['Без аккаунтов · Без облака · Без лишнего', 'No accounts · No cloud · No clutter'],
  ['ПОДКЛЮЧЕНО К STEAM', 'CONNECTED TO STEAM'], ['Твои библиотеки', 'Your libraries'], ['Закрыть', 'Close'], ['Обычно мы находим их автоматически. Если чего-то не хватает, укажи папку Steam, SteamLibrary или steamapps.', 'We usually find them automatically. If something is missing, add the Steam, SteamLibrary or steamapps folder.'], ['Добавить библиотеку', 'Add library'], ['Например, D:\\SteamLibrary', 'For example, D:\\SteamLibrary'], ['Добавить', 'Add'],
  ['Диск или папка сейчас недоступны', 'The drive or folder is currently unavailable'], ['Папка не найдена', 'Folder not found'], ['Сведения об установке, обложки и лицензии аккаунта читаем из локального Steam. Файлы Steam не меняем. Размеры неустановленных игр и описания показанных игр подгружаем из Steam Store. Передаём только публичный номер игры и язык описания, без аккаунта, лицензий и путей к файлам. Сервис видит IP-адрес соединения. Размеры можно отключить в «Настройках». Описания загружаются для выбранной игры и небольшого набора кадров перемешивания, не для всей библиотеки. Пароль и API-ключ не нужны. Для запуска игр может потребоваться вход, лицензия или обновление в Steam.', 'Installation details, covers and account licenses are read from local Steam data. Steam files are never changed. Uninstalled-game sizes and descriptions of displayed games come from Steam Store. Only the public game ID and description language are sent, without your account, licenses or file paths. The service sees the connection IP address. Sizes can be disabled in Settings. Descriptions are requested for the selected game and a small set of shuffle frames, not the whole library. No password or API key is required. Starting a game may require sign-in, a license or an update in Steam.'],
  ['КАК ТЕБЕ УДОБНЕЕ', 'MAKE IT YOURS'], ['Отображение', 'Display'], ['Закрыть настройки', 'Close settings'], ['Выбери, какую информацию показывать об играх.', 'Choose what information to show about games.'], ['Размер неустановленных игр', 'Uninstalled game size'], ['Рядом с «Не установлена» на большой обложке и в списке библиотеки', 'Next to “Not installed” on the large cover and in the library'], ['Плашка установленной игры', 'Installed game badge'], ['Диск и занятое место в верхнем углу большой обложки', 'Drive and used space in the top corner of the large cover'], ['Загружаем настройки…', 'Loading settings…'], ['Повторить загрузку', 'Retry loading'],
  ['Язык и оформление', 'Language and appearance'], ['Язык интерфейса', 'Interface language'], ['Русский или English', 'Russian or English'], ['Русский', 'Русский'], ['Тема', 'Theme'], ['Подбери комфортный фон', 'Choose a comfortable background'], ['Тёмный лес', 'Dark Forest'], ['Полночь', 'Midnight'], ['Графит', 'Graphite'], ['Акцентный цвет', 'Accent color'], ['Кнопки, переключатели и подсветка', 'Buttons, switches and highlights'], ['Лайм', 'Lime'], ['Синий', 'Blue'], ['Фиолетовый', 'Violet'], ['Оранжевый', 'Orange'], ['Своя палитра', 'Custom palette'], ['Создай случайный вариант, настрой цвета и сохрани только если понравится', 'Generate a random palette, adjust its colors and save it only if you like it'], ['Случайные цвета', 'Random colors'], ['Основной', 'Primary'], ['Наведение', 'Hover'], ['Текст на кнопках', 'Button text'], ['Сохранить палитру', 'Save palette'], ['Сохранённая палитра готова к предпросмотру.', 'The saved palette is ready to preview.'], ['Сохранённая палитра включена.', 'The saved palette is active.'], ['Предпросмотр отменён. Возвращена сохранённая тема.', 'Preview cancelled. The saved theme is back.'], ['Это предпросмотр. Сохрани палитру, если она понравилась.', 'This is a preview. Save the palette if you like it.'], ['Случайная палитра включена для предпросмотра. Её можно изменить или сохранить.', 'A random palette is being previewed. You can edit or save it.'], ['Своя палитра сохранена и включена.', 'Your custom palette is saved and active.'], ['Сохраняем палитру…', 'Saving palette…'], ['Цветовая палитра сохранена', 'Color palette saved'], ['Загружаем язык и оформление…', 'Loading language and appearance…'], ['Язык и оформление сохраняются в папке приложения.', 'Language and appearance are saved in the app folder.'], ['Язык и оформление сохранены.', 'Language and appearance saved.'],
  ['Windows', 'Windows'], ['Ярлык на рабочем столе', 'Desktop shortcut'], ['Открывает именно эту копию Play Next', 'Opens this copy of Play Next'], ['Запуск вместе с Windows', 'Start with Windows'], ['Программа запускается в фоне без открытия браузера', 'The app starts in the background without opening a browser'], ['Проверяем настройки Windows…', 'Checking Windows settings…'], ['Повторить проверку', 'Retry check'],
  ['Обновления', 'Updates'], ['Автообновление при запуске', 'Update automatically at startup'], ['При следующем запуске программа сама скачает, проверит и применит новую версию', 'At the next startup, the app downloads, verifies and applies the new version'], ['Сообщать о новой версии отдельным окном', 'Show a separate new-version notice'], ['Само обновление всегда остаётся доступно в настройках', 'Updates always remain available in settings'], ['Загружаем настройки обновлений…', 'Loading update settings…'], ['Проверить сейчас', 'Check now'], ['Установить сейчас', 'Install now'], ['Открыть страницу релиза', 'Open release page'],
  ['ДОСТУПНО ОБНОВЛЕНИЕ', 'UPDATE AVAILABLE'], ['Вышла новая версия Play Next', 'A new Play Next version is available'], ['Закрыть уведомление об обновлении', 'Close update notice'], ['Можно установить новую версию сейчас или вернуться к этому позже.', 'Install the new version now or come back to it later.'], ['Установить обновление', 'Install update'], ['Позже', 'Later'], ['Больше не показывать это окно', 'Do not show this notice again'], ['Автообновление при запуске включено.', 'Automatic updates at startup are enabled.'], ['Автообновление при запуске выключено.', 'Automatic updates at startup are disabled.'], ['Окно о новой версии включено.', 'The new-version notice is enabled.'], ['Окно о новой версии выключено.', 'The new-version notice is disabled.'],
  ['Резервная копия', 'Backup'], ['Сохрани категории, историю, исключения и настройки одним файлом. Его можно использовать после переустановки или переноса программы.', 'Save categories, history, exclusions and settings in one file. Use it after reinstalling or moving the app.'], ['Скачать копию', 'Download backup'], ['Восстановить из файла', 'Restore from file'], ['Данные остаются только на этом компьютере, пока ты сам не сохранишь файл.', 'Your data stays on this computer until you choose to save a file.'], ['Собираем резервную копию…', 'Preparing backup…'], ['Резервная копия скачана. Храни её как обычный личный файл.', 'Backup downloaded. Store it like any other personal file.'], ['Проверяем и восстанавливаем данные…', 'Checking and restoring data…'], ['Данные восстановлены. Перезапускаем страницу…', 'Data restored. Reloading the page…'],
  ['СОБЕРИ СВОИ ПОДБОРКИ', 'BUILD YOUR COLLECTIONS'], ['Выбери подборку, отметь сразу несколько игр и сохрани одним действием.', 'Choose a collection, select several games and save them in one action.'], ['Выбор категории', 'Category selection'], ['Игры в категории', 'Games in category'], ['Поиск игры для категории', 'Search games for category'], ['Фильтр игр', 'Game filter'], ['Добавлены', 'Added'], ['Не добавлены', 'Not added'], ['Добавить найденные', 'Add visible'], ['Убрать найденные', 'Remove visible'], ['Нет изменений', 'No changes'], ['Отменить', 'Cancel'], ['Сохранить', 'Save'], ['Добавить в категорию', 'Add to category'], ['Управлять категориями', 'Manage categories'], ['Создать категорию', 'Create category'], ['Создать, переименовать или удалить категорию', 'Create, rename or delete a category'], ['Новая категория', 'New category'], ['Например, На вечер', 'For example, Evening'], ['Загружаем категории…', 'Loading categories…'], ['Загружаем краткое описание из Steam Store…', 'Loading a short description from Steam Store…'], ['Для выбора игры включи JavaScript в браузере.', 'Enable JavaScript in your browser to pick a game.'],
  ['Все участвующие', 'All included'], ['Только установленные', 'Installed only'], ['Только неустановленные', 'Uninstalled only'], ['Ещё не запускались', 'Never played'], ['Не запускались 90 дней', 'Not played for 90 days'], ['Категория', 'Category'], ['Повторы разрешены', 'Repeats allowed'],
  ['Настройки сохраняются автоматически в папке приложения.', 'Settings are saved automatically in the app folder.'], ['Настройки сохранены.', 'Settings saved.'], ['Сохраняем…', 'Saving…'], ['Применяем настройку…', 'Applying setting…'], ['Изменения применяются сразу к этой копии программы.', 'Changes apply immediately to this copy of the app.'], ['Эти функции доступны только в Windows.', 'These features are only available on Windows.'], ['Автоматическая установка включена.', 'Automatic installation is enabled.'], ['Автоматическая установка выключена.', 'Automatic installation is disabled.'], ['Проверяем…', 'Checking…'],
  ['Не установлена', 'Not installed'], ['Установлена', 'Installed'], ['Обновление', 'Update required'], ['В библиотеке', 'In library'], ['Участвует', 'Included'], ['Исключена', 'Excluded'], ['Размер неизвестен', 'Unknown size'], ['Размер не указан', 'Size unavailable'], ['Проверяем размер…', 'Checking size…'], ['Место:', 'Disk space:'],
  ['Категории недоступны. Нажми «Обновить список» в библиотеке.', 'Categories are unavailable. Click “Refresh list” in the library.'], ['Создай первую подборку.', 'Create your first collection.'], ['Категорий пока нет. Создай первую подборку ниже.', 'No categories yet. Create your first collection below.'], ['По этому фильтру игр не найдено.', 'No games match this filter.'], ['Папка не найдена', 'Folder not found'], ['Автоматически найденных библиотек пока нет.', 'No automatically detected libraries yet.'],
  ['СЕГОДНЯ В ИГРЕ', 'TODAY\'S PICK'], ['ТВОЯ СЛЕДУЮЩАЯ ИГРА', 'YOUR NEXT GAME'], ['ИСКЛЮЧЕНА ИЗ БУДУЩИХ РОЗЫГРЫШЕЙ', 'EXCLUDED FROM FUTURE DRAWS'], ['СЛУЧАЙ ВЫБРАЛ. НАЧНЁМ С УСТАНОВКИ.', 'CHANCE HAS SPOKEN. LET\'S INSTALL IT.'], ['СЛУЧАЙ ВЫБРАЛ. ОСТАЛОСЬ НАЖАТЬ PLAY.', 'CHANCE HAS SPOKEN. JUST PRESS PLAY.'], ['Обложка из твоей библиотеки Steam', 'Cover from your Steam library'], ['НАЧНЁМ С ТВОЕЙ БИБЛИОТЕКИ', 'LET\'S START WITH YOUR LIBRARY'], ['ПЕРЕМЕШИВАЕМ ТВОЮ БИБЛИОТЕКУ', 'SHUFFLING YOUR LIBRARY'],
  ['Вечер свободен. Игра найдётся.', 'The evening is free. We will find a game.'], ['Твоя следующая игра уже где-то рядом.', 'Your next game is already nearby.'], ['Нажми «Выбрать игру» - мы найдём, во что погрузиться сегодня.', 'Click “Pick a game” and we will find something to dive into today.'], ['Если Steam установлен в необычной папке, укажи её в разделе «Библиотеки».', 'If Steam is installed in an unusual folder, add it under “Libraries”.'],
  ['Хочу пройти', 'Want to finish'], ['Любимые', 'Favorites'], ['Для компании', 'With friends'], ['Расслабиться', 'Relax'], ['На 30 минут', '30 minutes'], ['Сюжетные', 'Story games'],
  ['Размеры неустановленных игр запрашиваются из Steam Store. «Место» - требуемый объём на диске по данным издателя, не размер скачивания. Ссылка Steam рядом с размером открывает источник. Данные сохраняются на 7 дней и остаются доступны без интернета. Запасной вариант «≈» - оценка основной игры из локального Steam без DLC. Если оба источника не содержат размера, покажем «Размер не указан». Выключи этот переключатель, чтобы скрыть размеры и остановить новые интернет-запросы.', 'Sizes for uninstalled games are requested from Steam Store. “Disk space” is the publisher\'s requirement, not download size. The Steam link next to a size opens its source. Data is cached for 7 days and remains available offline. “≈” is a base-game estimate from local Steam data without DLC. If neither source has a size, the app shows “Size unavailable”. Turn this switch off to hide sizes and stop new internet requests.'],
  ['В Steam Store передаётся только публичный номер запрашиваемой игры, а для краткого описания - выбранный язык интерфейса; сервис также видит IP-адрес соединения. Аккаунт, лицензии, пути к файлам и исключения не отправляются. Сохранённые размеры и описания находятся в папке data приложения и не входят в ZIP для друзей.', 'Only the public game ID is sent to Steam Store, plus the selected interface language for a short description; the service also sees the connection IP address. Your account, licenses, file paths and exclusions are not sent. Cached sizes and descriptions stay in the app\'s data folder and are not included in the ZIP shared with friends.'],
  ['Обновления проверяются при запуске. Если автообновление включено, новая версия установится во время запуска программы. Иначе о ней сообщит отдельное окно, пока ты не отключишь его. Обновление всегда можно запустить вручную здесь. Архив и контрольная сумма загружаются с GitHub, а папка data не заменяется.', 'Updates are checked at startup. When automatic updates are enabled, a new version is installed while the app starts. Otherwise a separate notice appears until you disable it. You can always install an update manually here. The archive and checksum are downloaded from GitHub, while the data folder is never replaced.'],
  ['Самое время познакомиться поближе.', 'A perfect time to get acquainted.'], ['Ты уже заглядывал сюда сегодня. Продолжим?', 'You already played this today. Keep going?'], ['Следующий выбор начнёт новый круг.', 'The next pick will start a new round.'], ['Добавь библиотеку, чтобы начать.', 'Add a library to get started.'], ['Загружаем сохранённые категории и историю.', 'Loading saved categories and history.'], ['Выбираем…', 'Picking…'], ['Сохраняем исключения…', 'Saving exclusions…'], ['Исключения сохранены в приложении', 'Exclusions saved in the app'], ['Исключения ещё не загружены', 'Exclusions are not loaded yet'],
]);

const patterns = [
  [/^Не удалось восстановить данные\. Прежние данные возвращены\. ([\s\S]*)$/, match => `Could not restore data. Your previous data was restored. ${match[1]}`],
  [/^Библиотек: (\d+)$/, match => `Libraries: ${match[1]}`],
  [/^Выпало (\d+) из (\d+) в этом круге$/, match => `Drawn ${match[1]} of ${match[2]} this round`],
  [/^Показано (\d+) из (\d+) игр$/, match => `Showing ${match[1]} of ${match[2]} games`],
  [/^Категорий: (\d+) из 20\. Отметь нужные игры и нажми «Сохранить»\.$/, match => `Categories: ${match[1]} of 20. Select games and click “Save”.`],
  [/^Изменений: (\d+) · в подборке: (\d+)$/, match => `Changes: ${match[1]} · in collection: ${match[2]}`],
  [/^В подборке: (\d+) · изменений нет$/, match => `In collection: ${match[1]} · no changes`],
  [/^Установленных игр: (\d+)$/, match => `Installed games: ${match[1]}`],
  [/^Текущая версия: (.+)$/, match => `Current version: ${match[1]}`],
  [/^Установлена актуальная версия (.+)\.$/, match => `The latest version ${match[1]} is installed.`],
  [/^Доступна версия (.+)\. Установлена (.+)\.$/, match => `Version ${match[1]} is available. Installed: ${match[2]}.`],
  [/^Доступна версия (.+)\. Сейчас установлена (.+)\. Можно обновиться сейчас или вернуться к этому позже\.$/, match => `Version ${match[1]} is available. Currently installed: ${match[2]}. Update now or come back to it later.`],
  [/^Проверяем обновления\. Текущая версия: (.+)\.$/, match => `Checking for updates. Current version: ${match[1]}.`],
  [/^Не удалось связаться с GitHub\. Текущая версия: (.+)\.$/, match => `Could not reach GitHub. Current version: ${match[1]}.`],
  [/^Последний запуск: (.+)\. Почему бы не вернуться\?$/, match => `Last played: ${match[1]}. Why not return?`],
  [/^Категория: (.+)$/, match => `Category: ${match[1]}`],
  [/^Название категории (.+)$/, match => `Category name: ${match[1]}`],
  [/^Удалить категорию (.+)$/, match => `Delete category ${match[1]}`],
  [/^Категории: (.+)$/, match => `Categories: ${match[1]}`],
  [/^Изменить категории игры (.+)$/, match => `Edit categories for ${match[1]}`],
  [/^Добавлено в «(.+)»$/, match => `Added to “${translate(match[1])}”`],
  [/^Убрано из «(.+)»$/, match => `Removed from “${translate(match[1])}”`],
  [/^Участвует в розыгрыше: (.+)$/, match => `Included in draw: ${match[1]}`],
  [/^Добавить в категорию: (.+)$/, match => `Add to category: ${match[1]}`],
  [/^Источник размера (.+) в Steam$/, match => `Size source for ${match[1]} on Steam`],
  [/^На обложке: (.+)$/, match => `Cover: ${match[1]}`],
  [/^Новый круг\. Сегодня - (.+)$/, match => `New round. Today: ${match[1]}`],
  [/^Твой выбор: (.+)$/, match => `Your pick: ${match[1]}`],
  [/^Режим выбора: (.+)$/, match => `Selection mode: ${translate(match[1])}`],
  [/^(.+): (\d+)\. У каждой игры равный шанс\.$/, match => `${translate(match[1])}: ${match[2]}. Every game has an equal chance.`],
  [/^В режиме «(.+)» нет подходящих игр\.$/, match => `No eligible games in “${translate(match[1])}” mode.`],
  [/^Служебные компоненты Steam скрыты: (\d+)\.$/, match => `Hidden Steam utility components: ${match[1]}.`],
  [/^Пропущены незавершённые, пустые или недоступные установки: (\d+)\.$/, match => `Skipped incomplete, empty or unavailable installations: ${match[1]}.`],
  [/^Последняя проверка: (.+)\.$/, match => `Last checked: ${match[1]}.`],
];

export function getLanguage() { return language; }
export function getLocale() { return language === 'en' ? 'en-US' : 'ru-RU'; }
export function tr(ru, en) { return language === 'en' ? en : ru; }

export function translate(source) {
  if (language !== 'en' || typeof source !== 'string' || !source) return source;
  if (exact.has(source)) return exact.get(source);
  for (const [pattern, replacer] of patterns) {
    const match = pattern.exec(source);
    if (match) return replacer(match);
  }
  return source;
}

function translateTextNode(node) {
  const current = node.data;
  let record = textSources.get(node);
  if (!record || current !== record.output) record = { source: current, output: current };
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(record.source);
  record.output = match ? match[1] + translate(match[2]) + match[3] : record.source;
  textSources.set(node, record);
  if (current !== record.output) node.data = record.output;
}

function translateAttribute(element, name) {
  if (!element.hasAttribute(name)) return;
  let records = attributeSources.get(element);
  if (!records) { records = new Map(); attributeSources.set(element, records); }
  const current = element.getAttribute(name);
  let record = records.get(name);
  if (!record || current !== record.output) record = { source: current, output: current };
  record.output = translate(record.source);
  records.set(name, record);
  if (current !== record.output) element.setAttribute(name, record.output);
}

function translateTree(root) {
  if (root.nodeType === Node.TEXT_NODE) { translateTextNode(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) translateTextNode(node);
  const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('*')] : root.querySelectorAll('*');
  for (const element of elements) for (const name of ['aria-label', 'title', 'placeholder']) translateAttribute(element, name);
}

export function setLanguage(next) {
  if (!['ru', 'en'].includes(next)) return;
  language = next;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
    translateTree(document);
    document.dispatchEvent(new CustomEvent('playnext-language-change', { detail: { language: next } }));
  }
  for (const listener of listeners) listener(next);
}

export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startLocalization() {
  if (typeof document === 'undefined' || observer) return;
  translateTree(document);
  observer = new MutationObserver(records => {
    observer.disconnect();
    for (const record of records) {
      if (record.type === 'characterData') translateTextNode(record.target);
      else if (record.type === 'attributes') translateAttribute(record.target, record.attributeName);
      else for (const node of record.addedNodes) translateTree(node);
    }
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder'] });
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder'] });
}

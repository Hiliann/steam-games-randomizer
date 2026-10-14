# Изменения

## 2.4.0

### Русский

- Восстановление резервной копии стало понятнее: весь файл проверяется до подтверждения, без изменения сохранённых данных.
- Новое окно показывает дату копии, версию программы, количество категорий, игр с категориями, записей истории, исключений и дополнительных папок Steam. По умолчанию фокус на отмене; замена начинается только по явной кнопке.
- После подтверждения восстанавливается именно проверенное содержимое, без повторного чтения файла. Повреждённые копии отклоняются, ошибка записи оставляет возможность повторить или отменить; отмена до замены не меняет данные.
- Исправлен английский перевод ошибок резервного копирования. При разрыве связи после подтверждения приложение не обещает, что данные точно не изменились, а просит проверить результат.
- Начальная подпись версии в настройках берётся из версии интерфейса, а не из устаревшего значения. Формат копий остаётся совместимым с предыдущими версиями.

### English

- Backup restoration now validates the entire file before confirmation, without changing saved data.
- A clear confirmation shows its date, app version and counts of categories, categorized games, history, exclusions and custom Steam folders. Cancel is focused by default; replacing data requires an explicit button press.
- Confirmation restores the exact inspected payload without rereading the file. Invalid backups are rejected; a failed write allows retry or cancellation. Cancelling before replacement does not alter saved data.
- Localized backup errors in English. A connection failure after confirmation no longer incorrectly promises that data was untouched; it asks the user to check the result.
- Initial version text uses the interface version rather than an obsolete constant. The backup format remains compatible with earlier versions.

## 2.3.1

### Русский

- Ускорена сортировка библиотеки и подборок: механизм сравнения названий создаётся один раз на операцию, а не для каждой пары игр. Естественный порядок чисел, языков и одинаковых названий сохранён.
- Изменение категории из карточки больше не перестраивает скрытый массовый редактор. Его список обновляется при открытии.
- Ошибка отображения полученного размера не останавливает очередь остальных игр. Ошибка остаётся доступна в локальной диагностике; дополнительные данные никуда не отправляются.
- У поиска теперь единая рамка фокуса вместо двойной подсветки поля и внутреннего ввода.
- Добавлен отдельный тест производительности на искусственных библиотеках без чтения Steam и без телеметрии. Сохранённые данные и вероятность выбора не меняются.

### English

- Faster library and collection sorting: the name collator is reused within each operation instead of being recreated for every comparison. Natural numeric, international and equal-name ordering is preserved.
- Editing a category from game details no longer rebuilds the hidden bulk editor. Its list refreshes when opened.
- A size display failure cannot stall requests for other games. Errors remain locally diagnosable; no extra data is transmitted.
- Search uses one consistent focus outline rather than separate outlines around its container and input.
- Added a developer-only benchmark using synthetic libraries, without Steam access or telemetry. Saved data and random-selection odds remain unchanged.

## 2.3.0

### Русский

- Редактор категорий показывает, сколько игр найдено, сколько будет добавлено и удалено. Массовые действия показывают число затрагиваемых игр.
- Добавлены очистка поиска, очистка по Escape и сброс всех фильтров подборки. Открытие конкретной игры сбрасывает старые фильтры, которые могли её скрывать.
- При работе с клавиатуры фокус переходит к следующей игре, если отмеченная игра исчезла из фильтра. В полном списке отметка больше не перестраивает все строки.
- Ctrl+F ищет внутри текущей подборки, Ctrl+S сохраняет её без перехода на другой экран. Сохранение и защита несохранённых изменений остаются прежними.
- Длинные названия подборок переносятся в заголовке. Исправлено растяжение поля поиска в узком окне.
- Подсчёт игр во всех категориях выполняется одним проходом. Убрано озвучивание всего списка при каждом изменении; отдельно объявляются результаты и состояние черновика.
- Подготовлена история сохранённых релизов без изменения оригинальных архивов и существующих тегов. Формат пользовательских данных не меняется.

### English

- Collection editing shows visible game counts and separate addition/removal totals. Bulk actions indicate how many games they affect.
- Added search clearing, Escape to clear search and a collection filter reset. Opening a specific game clears older filters that could hide it.
- Keyboard focus moves to a surviving game when a checked row disappears from a membership filter. Unfiltered edits no longer rebuild every row.
- Ctrl+F searches the current collection and Ctrl+S saves it without navigating away. Existing save and unsaved-draft protections remain intact.
- Long collection headings wrap safely. Fixed stretched search boxes in narrow windows.
- Collection counts use a single pass. Screen readers receive result and draft updates rather than announcements of the entire game list.
- Prepared original release history without modifying archived builds or existing tags. Saved user data formats remain unchanged.

## 2.2.0

### Русский

- Восстановлена смена изображений при перемешивании. Каждый кадр показывает полную карточку одной игры: название, обложку, описание, категории и действия.
- Кнопки не исчезают, но заблокированы до сохранения результата. Запуск, исключение, меню категорий и повторные нажатия защищены от действий с промежуточной игрой.
- Предзагрузка локальных изображений ограничена текущим розыгрышем. Поздняя загрузка не подменяет новый кадр; отсутствующий hero заменяется обложкой той же игры.
- Описания загружаются не более чем двумя параллельными запросами с приоритетом итоговой игры; ненужная очередь кадров очищается. При отсутствии интернета используются локальные сведения.
- Сохраняется высота карточки и положение действий. При отключённых анимациях сразу показывается итоговая игра.
- Ошибка подготовки или сохранения снимает блокировку и не записывает промежуточные кадры в историю. Форматы пользовательских данных не меняются.
- Добавлен план развития PLAN.md; первый этап посвящён надёжности выбора, последующие - библиотеке, категориям, производительности и сохранности данных.

### English

- Restored changing artwork during shuffle. Each frame shows a complete, consistent game card with its title, artwork, description, categories and actions.
- Actions stay visible but disabled until the result is saved. Launching, exclusion, categories and repeated inputs cannot act on a decorative frame.
- Local artwork preloading is limited to the current draw. Late image loads cannot replace newer frames; missing heroes fall back to the same game's cover.
- Descriptions use at most two parallel requests with priority for the winner; unused queued frames are discarded. Offline frames show local game details.
- Card height and action placement remain stable. Reduced-motion mode skips decorative frames.
- Preparation or save failures release the controls without adding decorative frames to history. User data formats remain unchanged.
- Added PLAN.md covering selection reliability, library and category usability, performance and data safety.

## 2.1.2

### Русский

- Переработана большая карточка: убрана пустая область под короткими описаниями. Свободное место занимает обложка, информация и кнопки собраны в компактную панель.
- Статус готовности или обновления перенесён на изображение. Скрытые категории и ссылка описания больше не оставляют пустые строки.
- Высота внешнего блока не зависит от игры, а во время перемешивания сохраняется также размер изображения.
- Длинное описание обрезается целыми строками; полный текст открывается отдельно. Исправлен расчёт строк при повторных измерениях компактного блока.
- Уменьшены избыточные отступы панели выбора без уменьшения текста и кнопок. Настройки и сохранённые данные не меняются.
- Исправлена ссылка на закреплённый SDK WebView2 в инструкции сборки.

### English

- Redesigned game details to remove the empty space below short descriptions. Artwork fills spare room; information and actions form a compact lower panel.
- Moved readiness and update status onto the artwork. Hidden categories and description links no longer reserve empty rows.
- The outer frame remains stable between games; artwork geometry is also held during shuffle animation.
- Long descriptions clamp to whole lines and open separately. Repeated measurements no longer shrink compact descriptions.
- Tightened excessive spacing in the draw panel without reducing text or button sizes. Saved user data stays unchanged.
- Corrected the pinned WebView2 SDK link in build instructions.

## 2.1.1

### Русский

- Полосы прокрутки появляются при прокрутке и плавно исчезают, не меняя ширину интерфейса. Прокрутка мышью, клавиатурой и перетаскиванием остаётся штатной.
- Исправлена обрезка меток категорий. В карточках кнопка управления размещена отдельно, а в режиме списка категории расположены сбоку и могут переноситься без обрезки строки.
- Высота большой карточки игры фиксирована. Описание занимает доступное место целыми строками, а полный текст открывается в отдельном окне.
- Для установленной игры с обновлением основная кнопка называется «Обновить и играть»: Steam запускает обновление перед игрой. Повторное предупреждение под описанием убрано.
- Управление участием перемещено к основным действиям. Убраны повторный статус «Участвует в выборе» и нижний переход в библиотеку.
- Добавлен анимированный экран запуска с иконкой и реальными этапами загрузки, а также оформление начального экрана Windows. Анимация учитывает настройки уменьшения движения, не задерживает запуск искусственно и отключается в свёрнутом окне.
- Категории, исключения, история и настройки сохраняют прежний формат.

### English

- Native scrollbars appear during scrolling and fade out without resizing the interface. Mouse, keyboard and scrollbar dragging remain browser-managed.
- Fixed clipped category tags. Card controls have their own space; list-view categories appear beside game details and wrap without vertical clipping.
- Game details keep a fixed height. Descriptions use the available space in whole lines; full text opens in a separate dialog.
- Installed games requiring an update show “Update and play”, asking Steam to update before launching. Removed the duplicate update warning.
- Participation controls sit beside the main actions. Removed the redundant included status and bottom library shortcut.
- Added an animated startup screen with the app icon and real loading stages, plus a matching native Windows startup panel. Animations respect reduced-motion preferences, never add an artificial wait and stop in minimized windows.
- Existing user data formats remain unchanged.

## 2.1.0

### Русский

- Карточка игры переработана: обложка отделена от текста, информация и действия размещены на непрозрачной панели. Увеличены размеры основного текста и кнопок.
- Статус установки и участие в случайном выборе показаны отдельно. Исключённую игру можно вернуть прямо из карточки, не переходя в библиотеку.
- Длинные описания можно раскрыть и свернуть. Меню категорий больше не обрезается краем карточки; оно закрывается по нажатию снаружи и Escape.
- Активные фильтры библиотеки представлены отдельными метками, каждый можно удалить независимо от остальных.
- В узком окне выбор игры расположен выше карточки, а его дополнительные параметры сворачиваются. В небольшом по высоте окне обложка занимает меньше места.
- При смене категории или экрана редактор предлагает сохранить изменения, продолжить без сохранения или остаться. При неудачной записи черновик и диалог остаются на экране.
- Подтверждение удаления категорий приведено к общему оформлению приложения. Игры и исключения при удалении категории не меняются.
- Решения и критерии проверки интерфейса описаны в DESIGN.md. Сохранён формат пользовательских данных.

### English

- Redesigned game details: artwork is separated from readable content and actions on an opaque panel. Increased body text and control sizes.
- Installation and participation are shown independently. Excluded games can be included again directly from their details.
- Expand or collapse long descriptions. Category menus are no longer clipped by the card and close on outside clicks or Escape.
- Active library filters have independently removable chips.
- In narrow windows, the picker appears above game details and its additional options collapse. Shorter windows use a more compact artwork area.
- Leaving a collection draft offers Save, Discard or Stay. Failed writes keep the draft and dialog visible.
- Category deletion uses the same application dialog style. Games and exclusions are preserved.
- Design research and acceptance criteria are documented in DESIGN.md. Existing user data formats remain unchanged.

## 2.0.1

### Русский

- Новая иконка Play Next: единый знак в приложении, ярлыках и файле запуска, семь размеров Windows от 16 до 256 пикселей с прозрачностью.
- Добавлена отмена исключения и возврата игры прямо из уведомления. Уведомление не исчезает, пока над ним указатель или на кнопке находится клавиатурный фокус.
- Библиотека фильтруется по установке, категориям, участию и названию одновременно. Статус установки запоминается вместе с видом и сортировкой.
- Поиск получил кнопку очистки и очистку по Escape, все фильтры можно сбросить одним действием. Фильтры просмотра не меняют состав случайного выбора.
- Сохранён прежний формат категорий, исключений, истории и настроек; обновление не заменяет папку data.

### English

- New Play Next app icon shared by the interface, executable and Windows shortcuts, with seven transparent Windows sizes from 16 to 256 pixels.
- Undo participation changes directly from a notification. Hovering or focusing the action keeps the notification visible.
- Combine installation status, categories, participation and name filters. Installation status is remembered alongside library view and sorting.
- Clear search with a button or Escape, and reset all filters in one action. Browsing filters do not change the random draw pool.
- Preserved existing categories, exclusions, history and settings formats. Updates do not replace the data folder.

## 2.0.0

### Русский

- Play Next открывается в отдельном окне Windows на WebView2, без вкладки браузера.
- Повторный запуск возвращает существующее окно; автозапуск открывает свёрнутое приложение.
- Обрыв внутреннего соединения и простой больше не завершают приложение. Закрытие окна завершает его локальный процесс, включая аварийное закрытие.
- Добавлены автоматическое восстановление после сбоя локального процесса, состояние подключения и кнопка повторного запуска.
- Служебные ping/pong-сообщения соединения больше не считаются закрытием страницы.
- Интерфейс полностью перестроен под приложение: постоянная навигация, отдельные экраны выбора, библиотеки, категорий и настроек.
- Добавлены компактный список, сортировка библиотеки, просмотр игры по обложке без изменения истории и быстрые галочки категорий в карточках.
- Редактор подборок получил отдельную панель категорий, создание без скрытого меню и кнопку выбора из подборки. Настройки разделены на пять вкладок.
- Сохранены выбранные темы, акценты и формат данных. Добавлены защита несохранённых изменений при навигации и доступный поиск по Ctrl+F.
- Обновление отдельного окна освобождает исполняемые файлы перед заменой и открывает новую версию. Папка data не заменяется.

### English

- Play Next now opens in a dedicated WebView2 desktop window, not a browser tab.
- Launching again focuses the existing window; Windows startup opens it minimized.
- Idle time and renderer disconnections no longer stop the desktop service. Closing or terminating the window ends its local service.
- Added automatic service recovery, connection status and retry controls.
- Connection ping/pong frames no longer count as a closed page.
- Completely redesigned the application workspace with persistent navigation and separate chooser, library, categories and settings screens.
- Added list view, library sorting, cover previews without changing draw history, and quick category checkboxes on cards.
- Collections now have a sidebar, visible creation controls and a pick-from-collection shortcut. Settings use five focused tabs.
- Preserved saved themes, accents and data formats; added unsaved-change navigation guards and Ctrl+F library search.
- Desktop updates release executable files before replacing them and reopen the updated app. The data folder is preserved.

## 1.9.0

- Вместо команд запуска и остановки добавлен единый файл `Play Next.exe`.
- После закрытия последней вкладки локальная программа автоматически завершается; несколько вкладок и обычная перезагрузка страницы обработаны безопасно.
- Ярлыки рабочего стола и автозагрузки используют новый запускатель, а старые ярлыки обновляются автоматически.
- Переключатель автообновления больше не блокируется во время установки и сразу показывает выбранное состояние.
- Ошибка сохранения настройки больше не оставляет переключатели в заблокированном состоянии.
- Обновление со старых версий добавляет новый запускатель и убирает только прежние командные файлы Play Next, не изменяя папку `data`.
- Выпавшую игру теперь можно сразу добавить в одну или несколько категорий без поиска в общей библиотеке.
- Для результата показывается краткое описание из Steam Store на текущем языке интерфейса; оно проверяется как обычный текст и сохраняется в локальном кэше.
- При первом запуске язык интерфейса выбирается по системному языку, а уже сохранённый выбор пользователя не меняется.
- Игры в анимации выбора перемешиваются заново и не идут повторяющимся порядком.

### English

- Replaced separate start and stop command files with one `Play Next.exe` launcher.
- The local program now stops after its last browser tab closes, while multiple tabs and normal page reloads remain safe.
- Desktop and startup shortcuts use the new launcher, and existing managed shortcuts migrate automatically.
- The automatic-update switch remains available during installation and immediately reflects the selected state.
- A settings save error no longer leaves the switches locked.
- Updating from an older version adds the launcher and removes only Play Next's legacy command wrappers without changing the `data` folder.
- A picked game can now be added directly to one or more categories without searching the full library.
- The result shows a short Steam Store description in the current interface language, validated as plain text and stored in the local cache.
- A new copy chooses its initial interface language from the system locale without overriding a saved user choice.
- Games shown during the draw animation are reshuffled instead of following a repeating order.

## 1.8.1

- В настройках оформления появился генератор случайной цветовой палитры.
- Случайные цвета сначала применяются только как предпросмотр и не меняют сохранённую тему.
- Основной цвет, цвет наведения и цвет текста на кнопках можно отредактировать вручную.
- Палитру можно сохранить отдельной кнопкой или отменить, вернув прежнее оформление.
- Настройки версии 1.8.0 и старые резервные копии автоматически дополняются безопасной палитрой по умолчанию.

### English

- Added a random color-palette generator to appearance settings.
- Random colors start as a preview and do not replace the saved theme.
- The primary, hover and button-text colors can be edited manually.
- The palette can be saved explicitly or cancelled to restore the previous appearance.
- Settings from 1.8.0 and older backups automatically gain a safe default custom palette.

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

Перед ручным переносом файлов закрой последнюю вкладку приложения и сохрани свою папку `data`.

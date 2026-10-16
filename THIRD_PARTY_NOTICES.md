# Third-party components

Original Play Next source code is MIT licensed; see LICENSE in the repository
or runtime/PlayNext-LICENSE.txt in the Windows package. This does not relicense
Node.js, Microsoft components, Steam trademarks or game artwork. Their original
notices and conditions remain applicable.

Комплект программы содержит неизменённый официальный **Node.js 24.20.0 для Windows x64**.

- Источник: [официальный архив Node.js](https://nodejs.org/dist/v24.20.0/node-v24.20.0-win-x64.zip).
- Проверка целостности: [официальные контрольные суммы](https://nodejs.org/dist/v24.20.0/SHASUMS256.txt). Проверенная сумма и сведения о версии записаны в `release.json`.
- Полная лицензия Node.js и включённых в него компонентов поставляется без изменений в `runtime/LICENSE`.

Steam не включён в комплект. Программа читает сведения об установках, локальных лицензиях аккаунта и обложки из локального Steam пользователя. Место на диске для неустановленных игр запрашивается из Steam Store по публичному AppID; сведения о требованиях принадлежат соответствующим издателям. Игровые изображения, библиотеки пользователя, аккаунты, API-ключи, кэш размеров и файлы игр в архив не включаются. Steam и игровые изображения принадлежат соответствующим правообладателям. Проект не связан с Valve и не является её официальным продуктом.

Локальный сервер Play Next использует только встроенные средства Node.js; дополнительных npm-пакетов нет.

Окно Windows использует официальный Microsoft.Web.WebView2 SDK 1.0.4258.31. Неизменённые библиотеки и WebView2Loader.dll поставляются в `runtime/desktop/` вместе с оригинальными `LICENSE.txt` и `NOTICE.txt`.

- Источник: [пакет Microsoft на NuGet](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4258.31).
- SHA-256 пакета: `56f7f4b8bf9aee4b8efefbbdd4f67d5f74ebd1b100ed0806da71bf76af481aa9`.
- Evergreen WebView2 Runtime в архив не включён. Используется установленный компонент Microsoft, обновляемый отдельно от Play Next.

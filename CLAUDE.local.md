# Сессия 2026-09-03 — повторная архитектурная оценка + закрытие найденных пробелов

Продолжение сессии 2026-08-27 (ниже). С коммита `c52ddf3` до начала этой сессии репозиторий ушёл
на 8 коммитов вперёд (до `3f44b91`): unit-тесты (`cli-fallback.spec.ts`, `classify.spec.ts`),
circuit breaker + risk-tiered auto-merge + rollback в `agent-fixer`, AI cost/token observability
(`usage-log.ts`), CLAUDE.md routing index. По запросу пользователя ("повторно оцени фреймворк")
провёл независимую переоценку через Explore-агента (факты, без готовых выводов) + `advisor`, затем
исправил 4 найденных пробела и закоммитил (`1186b15`).

## Итоговая переоценка: 5/10 (было хуже на прошлой диагностике)

**Что реально улучшилось**: решение "сливать AI-фикс в master или нет" стало детерминированным
(тест зелёный 5x/2x + scope-check + circuit breaker на git-истории), не AI-вердиктом — единственный
блокирующий (не advisory) CI-гейт в системе. Подтверждено живым прогоном: PR #14 — единственный
случай auto-merge, реально попал в единственный разрешённый файл (`practice-form.page.ts`).

**Что не улучшилось**: `src/` вырос с 2945 до 4074 строк при тех же ~10-12 функциональных тестах
(рост, не стабилизация). Найдены и закрыты в этой сессии:

1. **Branch-prefix drift** — маршрутизация риска (`agent-fixer/cache/*` auto-merge vs
   `agent-fixer/ai/*` human-review) держалась на двух независимо редактируемых строковых литералах
   (`run.ts` строил ветку вручную, `regression.yml` матчил `startsWith(...)`) без общей константы и
   без теста на сквозной путь.
2. **`verify-stability.ts` — сам merge-гейт — был непокрыт тестами**, и это признавалось в его же
   заголовочном комментарии как "biggest risk". Соседний `safety-gates.ts` (чистые функции) имел
   тесты, а несущий гейт — нет.
3. **Circuit breaker и rollback ни разу не срабатывали в бою** — `git log --all | grep
   revert.*agent-fixer` пуст. Написаны и типизируются, но не проверены живым trip'ом.
4. **Cost observability не видела самый дорогой AI-вызов** — `reviewer-tests.ts`'s `claude -p
   --effort high` (paranoid-тир) и `gemini-text.ts` писали AI-вызовы мимо `usage-log.ts`.

### Исправления (коммит `1186b15`)

- `safety-gates.ts` теперь экспортирует `branchFor()` / `CACHE_TIER_BRANCH_PREFIX` /
  `AI_TIER_BRANCH_PREFIX` / `ALLOWED_TARGET_FILES` как единственный источник истины; `run.ts` и
  `verify-stability.ts` оба используют их вместо собственных копий. Новый тест
  (`safety-gates.spec.ts`) читает реальный `regression.yml` через `matchAll` (не первое совпадение
  — assert ровно одно) и падает, если литерал когда-нибудь разъедется.
- `verify-stability.ts` разбит на чистую `evaluateStability()` (инъекция runner'а) + тонкий
  `main()`; guard `if (require.main === module)` — импорт из теста больше не спавнит реальный
  Playwright. 14 новых тестов (`verify-stability.spec.ts`) проверяют порядок гейтов (scope-check
  ДО Playwright) и наличие `--retries=0` на каждом вызове (без него гейт декоративен — Playwright
  retry замаскировал бы нестабильность).
- README получил честную заметку: auto-merge сработал 1 раз в проде (PR #14), circuit
  breaker/rollback — только юнит-тестами логики, не живым инцидентом.
- `reviewer-tests.ts` и `gemini-text.ts` теперь вызывают `recordAiUsage()`. При этом `advisor`
  поймал реальную регрессию до коммита: переход `reviewer-tests.ts` на `--output-format json`
  (нужен для чтения usage) убирал бы echo результата в stdout и обнулял бы диагностику при ошибке
  парсинга (`text` стал бы `''`) — оба момента восстановлены явно, не унаследованы молча.
- `callerFrom()` в `gemini-text.ts` (мэппинг `logTag` → `caller` для cost-лога) экспортирован и
  покрыт тестом (`gemini-text.spec.ts`) — без этого будущий caller с небрекетным `logTag` тихо
  писал бы `'ai-agents'` в cost-стрим вместо реального имени.

### Осталось непроверенным, помечено честно

`--permission-mode plan` + `--output-format json` в `reviewer-tests.ts` — новая комбинация флагов,
не запускалась вживую (`runClaude` в `cli-fallback.ts` использует json с другим permission mode).
Не стал проверять живым AI-вызовом без запроса — цена вызова (реальные деньги/квота) не
оправдывалась в рамках этой сессии.

## Метод: как проводилась переоценка

Explore-агент собрал 9 категорий фактов строго без интерпретации (git история, объём кода,
unit-тесты, механика circuit breaker/auto-merge, cost observability, README, AI call sites,
блокирующие CI-гейты, `.env.example`) — читал реальный код, не commit messages. `advisor` затем
дважды проверял: один раз до написания оценки (указал, что нужно проверить `git show --stat` на
PR #14 и `git log --all | grep revert` вместо доверия commit messages — оба факта подтвердились
живой проверкой), второй раз после каждого раунда правок (поймал drop stdout echo, посоветовал не
провоцировать живой circuit breaker trip ради находки, которая дороже, чем стоит).

---

# Сессия 2026-08-27 — ключевые решения и работа

Рабочий репозиторий: `~/Work/IdeaProjects/tf-ts-ai` (НЕ `demo-tfw-ts` — тот нетронутый baseline).
Все изменения этой сессии закоммичены и запушены в `master`: коммит `c52ddf3` (устарело — см. раздел
сессии 2026-09-03 выше для актуального состояния, сейчас `1186b15`).

## Что сделано: goal-based тесты (src/goal-evolution/)

Развитие идеи "тест описывает цель, а не шаги". Архитектурная развилка была между:
- **A — runtime goal execution**: агент водит браузер на каждом прогоне теста. Отклонено —
  вернуло бы недетерминированный AI в решающий путь CI, то есть саму причину нескейлируемости
  фреймворка, которую диагностировали в прошлой сессии.
- **B — goal → spec compilation** (выбрано): агент резолвит цель ОДИН РАЗ офлайн, пишет обычный
  детерминированный Playwright-код. Прогоны в CI — без AI.

### Ключевой архитектурный принцип: разделение агент/оракул

Агент (`goal-solver` persona, `ai-agents/personas/goal-solver.md`, расширяет `test-developer`)
пишет ТОЛЬКО client/Page Object + функцию `achieve(...)`. Никогда не пишет spec-файл, никогда не
пишет `expect(...)`. Условие успеха (`Goal.succeedsWhen`) — написано человеком заранее, лежит в
`src/goal-evolution/goals/*.ts`, агент его не видит. Human-owned spec-файл
(`tests/{ui,api}/*-goal.spec.ts`) вызывает `achieve()`, затем `succeedsWhen()` в том же контексте.

Причина: "агент сам решил, что достиг цели" не является доказательством ничего — та же дыра,
которую закрывает check #3 ("assertion honesty") в персоне `reviewer-tests`.

### Два демо-примера (`src/goal-evolution/goals/`)

1. **`buttons-dynamic-click`** (UI, `tests/ui/buttons-goal.spec.ts`) — demoqa.com/buttons. Кнопка
   "Click Me" имеет id, регенерируемый при каждой загрузке страницы (`Ii9O4` → `QYyO7`, проверено
   вживую). Агент должен вывести `getByRole('button', {name: 'Click Me'})` вместо хардкода id —
   доказывает вывод *локатор-стратегии* из поведенческой заметки.
2. **`book-store-register-user`** (API, `tests/api/book-store-goal.spec.ts`) — demoqa.com Book
   Store. Форма `/register` защищена reCAPTCHA (проверено: клик Register возвращает "Please
   verify reCaptcha to register!" даже с валидными данными — обход CAPTCHA запрещён политикой).
   REST API `/Account/v1/User` не защищён капчей. Цель в prose никогда не говорит "используй API"
   — только заметка `docs/page-knowledge/book-store-register.md` документирует оба пути и
   называет вывод. Агент читает заметку и пишет API-клиент, не трогая UI.
   - **Калибровка claim'а**: агент не выводит заключение "API vs UI" сам с нуля — читает уже
     готовый вывод в файле и правильно действует. Это слабее, чем "вывел сам", но честнее.
   - Oracle не доверяет ответу самого driver'а — независимо перепроверяет через `GenerateToken` +
     повторную регистрацию (должна вернуть 406 "User exists!").
   - Harness (не driver) генерирует username/password — иначе driver мог бы тихо проглотить 406
     на существующем юзере и всё равно пройти oracle.
   - Cleanup через `DELETE` в `finally` — подтверждено вживую (лог "cleanup OK — user X deleted").

### `Goal<TCtx>` — generic-интерфейс (`src/goal-evolution/goal.ts`)

Один интерфейс на UI (`Page`) и API (`APIRequestContext`) цели. Поля: `id`, `description`,
`pageKnowledgeFile`, `driverFile`, `achieveSignature` (ТОЧНАЯ сигнатура `achieve()` — добавлено
после того, как агент дважды подряд вернул сырой `APIResponse` вместо `userID: string`, потому что
промпт не специфицировал возврат, только параметры), `succeedsWhen`, опционально `contractChecks`.

### `src/goal-evolution/run.ts` — три причины остановки, разный репортинг

1. **Генерация зависла** — `ATTEMPT_TIMEOUT_MS` (5 мин) на Claude-вызов через `CliTimeoutError`.
2. **Контракт нарушен** (агент написал `expect()`, захардкодил identity) — не ретраится, детект
   по чтению файла.
3. **Oracle не прошёл** — ретраится до `MAX_ATTEMPTS=2` (низко специально: каждая попытка
   `book-store-register-user` создаёт реального юзера на demoqa.com — orphan-account multiplier).
   Финальный репорт явно указывает на `pageKnowledgeFile` как вероятную причину.

Usage: `npm run goal-evolution -- <goal-id>` (buttons-dynamic-click | book-store-register-user).

## Найденный и исправленный баг: cli-fallback.ts не передавал ключ Gemini

`gemini` CLI ожидает переменную `GEMINI_API_KEY`, а НЕ `AI_API_KEY` (имя переменной этого
проекта). Без явной передачи CLI тихо падал на другой auth-путь с гораздо более низким лимитом —
воспроизведено: `-m gemini-3.6-flash` и `-m gemini-2.5-flash` оба возвращали 429 с одинаковым
низким лимитом независимо от модели (пока не передан ключ явно).

Важно: не суточный лимит, а короткое скользящее окно (retry-delay убывал линейно за секунды —
проверено эмпирически). С реальным ключом `-m` РЕАЛЬНО работает — разные модели дают разные,
корректные ответы. Это исправлено в комментариях кода (было переоценено как "1500/day, per model,
regardless of model requested" — после проверки убрано всё недоказанное, оставлено только
подтверждённое).

### Исправление: per-tier API ключи

`GEMINI_TIERS` теперь массив из 3 моделей (`gemini-3.5-flash`, `gemini-3.6-flash`,
`gemini-3.5-flash-lite`), каждая опционально со своим ключом:
`AI_AGENTS_GEMINI_API_KEY[_FALLBACK[_2]]` в `.env`. `resolveGeminiApiKey(tierIndex)` — backward
scan: ключ этого tier'а → ближайший заданный раньше → `AI_API_KEY` как последний resort. Fail
loud, если вообще ничего не резолвится (по аналогии с `reviewer-tests.ts`'s `requireProfileVar`).

**Ключи в `.env` (реальные секреты, НЕ в git, gitignored)**:
- `AI_AGENTS_GEMINI_API_KEY` = новый проект `gen-lang-client-0941437171` (tier 0)
- `AI_AGENTS_GEMINI_API_KEY_FALLBACK` = старый проект (tier 1)
- `AI_AGENTS_GEMINI_API_KEY_FALLBACK_2` = проект `gen-lang-client-0892906661` (tier 2)
- `AI_API_KEY` тоже заменён на новый проект целиком (по выбору пользователя) — это ЗНАЧИТ, что
  healwright'ов runtime self-healing (`fixtures.ts`, читает `AI_API_KEY`) тоже теперь на новом
  проекте — озвучено пользователю, не тихо.

**Живьём подтверждено end-to-end**: форсирован отказ Claude + tier0 + tier1 (несуществующие
модели/имена) → цепочка дошла до tier2 с новым отдельным ключом → сгенерировала рабочий driver →
oracle прошёл. Первая полная демонстрация всей 4-уровневой цепочки в этом репо.

### CliTimeoutError — проверено мок-тестом, НЕ живым прогоном run.ts целиком

`execFileSync(..., {timeout})` + `err.killed` — таймаут на Claude-звене бросает `CliTimeoutError`
немедленно, НЕ проваливается в Gemini fallback (иначе бюджет незаметно утроился бы). Проверено
детерминированным мок-скриптом (не сохранён в репо, был одноразовый в scratchpad) через
`require('child_process')` monkey-patch — ВАЖНО: `import * as cp` (ESM) не перехватывает вызов
внутри CJS-скомпилированного `cli-fallback.ts`, нужен именно `require()` для попадания в тот же
module-cache. Полный `run.ts`-цикл (retry, report(), delete-then-regenerate) остался НЕ проверен
живым прогоном — только typecheck. Не стал догонять это моками `tsc`/`playwright` — оценил как
больше инфраструктуры, чем стоит находка.

## README.md — актуализирован

Полное дерево из 10 секций (было 9, добавлена #8 Goal-Based Tests, остальные сдвинуты). Перед
финальным коммитом перепроверен целиком — найдены и исправлены: дублирующийся номер `12` на две
разные фичи, 4 устаревшие ссылки `(#N)` в Project Structure, оборванный/задвоенный текст в разделе
Self-Evolving Test Suite (след от sed-правки).

## Не забыть в следующей сессии

- **LinkedIn-пост**: 3 проверяемых факта из этой сессии уже собраны (см. память
  `tf_ts_ai_linkedin_metrics_tracking.md`) — баг с `GEMINI_API_KEY`, live-демо 4-уровневого
  fallback, agent сам выбрал API vs UI из-за reCAPTCHA. Пользователь попросил ЖДАТЬ ещё один кейс
  перед написанием поста, даже несмотря на то что порог (2-3 кейса) уже достигнут — уважать это
  явное решение, не писать пост, пока не появится следующий факт.
- Третий Gemini-ключ (`gen-lang-client-0892906661`) физически создан пользователем в AI Studio —
  я НЕ создаю такие проекты/ключи сам (создание учётных данных — запрещённое действие).
- `docs/page-knowledge/` теперь содержит 4 файла: `text-box.md`, `check-box.md` (из прошлых
  сессий), `buttons.md`, `book-store-register.md` (эта сессия). Остальные страницы demoqa.com не
  документированы.

## Добавлено: правило "headless Playwright вместо claude-in-chrome"

Пользователь спросил, есть ли в персонах агентов, пишущих тесты, правило не использовать
`claude-in-chrome` (реальный видимый браузер пользователя) вместо headless Playwright. Правила не
было — добавлено в двух местах:
- `ai-agents/personas/test-developer.md` — общий hard rule для всех агентов, пишущих тесты
  (test-evolution, agent-fixer, goal-solver его наследует).
- `ai-agents/personas/goal-solver.md` — усилено конкретно для goal-based режима (пункт 1: если
  page-knowledge файла нет или он неполный, НЕ лезть в `claude-in-chrome`, использовать headless
  Playwright-скрипт или флагать пробел вместо угадывания).

Причина правила: `claude-in-chrome` управляет реальной сессией пользователя (его профиль, вкладки,
куки) — недопустимо для агента, который просто хочет посмотреть DOM страницы при генерации теста.

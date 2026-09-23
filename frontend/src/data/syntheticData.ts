import type { Task } from '../types/task';
import type { Team } from '../types/team';
import type { Proposal } from '../types/proposal';
import type { TaskDraftSeed } from '../types/ai';
import { calculateRating, getReadinessLevel } from '../services/ratingService';

export const seedDrafts: TaskDraftSeed[] = [
  {
    id: 'draft-1',
    title: 'Telegram-бот для автоматизации заказов в пекарне',
    industry: 'FoodTech & Retail',
    text: 'Нам нужен бот для заказов выпечки в Telegram, чтобы клиенты не звонили зря. Сколько это стоит и когда сделаете?',
    completeness: 'weak',
    estimatedInitialScore: 25,
  },
  {
    id: 'draft-2',
    title: 'Мобильный учет посещаемости и абонементов фитнес-клуба',
    industry: 'Спорт & Здоровье',
    text: 'Мобильное приложение для тренеров и администраторов фитнес-клуба. Сейчас учет ведется в бумажном журнале. Нужен QR-код на входе и учет оставшихся тренировок. Срок 3-4 недели.',
    completeness: 'medium',
    estimatedInitialScore: 48,
  },
  {
    id: 'draft-3',
    title: 'AI-классификатор обращений в техподдержку стройматериалов',
    industry: 'Строительство & Девелопмент',
    text: 'Нужна система авто-категоризации обращений клиентов. У нас есть база из 5000 логов за прошлый год в CSV. Бот должен определять тип запроса (доставка, прайс, брак) и отвечать на типовые вопросы. Ожидаем снижение нагрузки на менеджеров на 35%.',
    completeness: 'medium',
    estimatedInitialScore: 72,
  },
  {
    id: 'draft-4',
    title: 'Автоматизация учета паллет на складе',
    industry: 'Логистика & Склад',
    text: 'Хотим автоматизировать склад. Всё на бумаге, теряются коробки. Сделайте что-нибудь на Python или 1С.',
    completeness: 'weak',
    estimatedInitialScore: 20,
  },
  {
    id: 'draft-5',
    title: 'Компьютерное зрение для контроля брака на упаковочной линии',
    industry: 'Промышленность & IoT',
    text: 'Разработка микросервиса компьютерного зрения для обнаружения дефектов термоусадочной пленки на конвейере. Предоставим RTSP-видеопоток и размеченный датасет из 2000 снимков. Формат сдачи: Docker-контейнер с REST/gRPC API. Ограничение по задержке: не более 180 мс на кадр. Критерий приемки: метрика F1-score >= 0.93 на отложенной тестовой выборке.',
    completeness: 'high',
    estimatedInitialScore: 88,
  },
];

const seedTaskInputs: Omit<Task, 'rating' | 'readinessLevel'>[] = [
  {
    id: 'task-1',
    title: 'AI-классификатор входящих платежных инцидентов и эквайринга',
    industry: 'FinTech',
    tags: ['Python', 'FastAPI', 'NLP', 'Docker', 'PostgreSQL'],
    context: 'Служба поддержки эквайринга обрабатывает более 1200 заявок в сутки. 65% из них типовые (ошибки POS-терминала, таймаут шлюза). Ручная сортировка занимает до 18 минут на тикет.',
    need: 'Автоматизировать первичную классификацию обращений и маршрутизацию на дежурных инженеров второй линии с авто-ответом на частые ошибки.',
    targetUsers: 'Операторы первой линии контакт-центра и инженеры дежурной смены мониторинга.',
    availableData: 'Обезличенный датасет из 15 000 тикетов (текст обращения, код ошибки, корректная категория) в формате CSV и доступ к тестовому webhook API.',
    constraints: 'Время инференса модели не более 400 мс на запрос. Стек backend: Python/FastAPI. Запрещено использование внешних облачных LLM с передачей клиентских данных.',
    expectedResult: 'Готовый сервис в Docker-контейнере с REST API endpoint /classify, покрытый тестами, и веб-интерфейс для оператора с подтверждением предсказаний.',
    successCriteria: 'Точность классификации (Macro F1) не ниже 0.91 на тестовом датасете. Сокращение времени обработки тикета до 2 минут.',
    contact: 'Руководитель группы поддержки: support-lead@bankpay.kz, Telegram: @fintech_support_lead',
    consultationFormat: 'Еженедельные 30-минутные синхроны по вторникам в Google Meet + чат в Telegram для оперативных вопросов.',
    confirmedFields: ['title', 'context', 'need', 'targetUsers', 'availableData', 'constraints', 'expectedResult', 'successCriteria', 'contact', 'consultationFormat'],
    confirmed: true,
    published: true,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-22T14:30:00.000Z',
  },
  {
    id: 'task-2',
    title: 'Предиктивная диагностика аномалий телеметрии серверных стоек',
    industry: 'Cloud & Infrastructure',
    tags: ['Python', 'Data Science', 'PyTorch', 'Time-Series', 'Docker'],
    context: 'ЦОД компании содержит 48 серверных стоек. Периодически происходят локальные перегревы из-за сбоев вентиляторов охлаждения, приводящие к троттлингу процессоров.',
    need: 'Разработать алгоритм обнаружения ранних аномалий в показаниях датчиков температуры и энергопотребления за 15-20 минут до наступления критического перегрева.',
    targetUsers: 'Дежурные инженеры дата-центра и системные администраторы инфраструктуры.',
    availableData: 'Временные ряды телеметрии за 6 месяцев с шагом 5 секунд (температура, RPM кулеров, ток, нагрузка CPU) в формате Parquet (2.4 GB).',
    constraints: 'Решение должно работать на стандартном Linux-сервере без дискретного GPU. Потребление RAM до 2 GB.',
    expectedResult: 'Модуль детекции аномалий с генерацией алертов в формате JSON и скрипт воспроизведения результатов с валидацией.',
    successCriteria: 'Recall по критическим инцидентам не менее 85% при уровне ложных тревог (False Positive Rate) не выше 4%.',
    contact: 'Инфраструктурный инженер: devops@cloudpulse.kz',
    consultationFormat: 'Письменная обратная связь в issues репозитория + звонок раз в две недели.',
    confirmedFields: ['title', 'context', 'need', 'targetUsers', 'availableData', 'constraints', 'expectedResult', 'successCriteria', 'contact', 'consultationFormat'],
    confirmed: true,
    published: true,
    createdAt: '2026-09-21T09:00:00.000Z',
    updatedAt: '2026-09-22T16:00:00.000Z',
  },
  {
    id: 'task-3',
    title: 'Мобильный детектор дефектов дорожного покрытия на базе компьютерного зрения',
    industry: 'Smart City & GovTech',
    tags: ['Flutter', 'Python', 'YOLO', 'Computer Vision', 'Mobile'],
    context: 'Городской акимат проводит мониторинг состояния дорожного полотна. Выездные инспекторы фиксируют ямы и трещины вручную на фотокамеру и составляют бумажные акты.',
    need: 'Создать мобильное приложение для инспектора, фиксирующее ямы на видео в движении с геолокацией и автоматической оценкой площади повреждения.',
    targetUsers: 'Дорожные инспекторы и специалисты мониторинга дорожной инфраструктуры.',
    availableData: 'Датасет из 3200 размеченных фотографий дорог Казахстана (ямы, продольные трещины, выбоины) с полигонами разметки.',
    constraints: 'Работа на смартфонах Android (Snapdragon 720G и выше). Локальная обработка без обязательного подключения к интернету во время съемки.',
    expectedResult: 'Мобильное приложение (APK) с моделью YOLOv8-nano на борту и веб-карта для отображения выявленных дефектов.',
    successCriteria: 'Детекция дорожных ям с точностью mAP@0.5 > 0.82 при скорости обработки не менее 15 кадров в секунду.',
    contact: 'Координатор проекта SmartCity: road-monitoring@astana.gov.kz',
    consultationFormat: 'Консультации через чат в Telegram по пятницам.',
    confirmedFields: ['title', 'context', 'need', 'targetUsers', 'availableData', 'expectedResult', 'contact'],
    confirmed: true,
    published: true,
    createdAt: '2026-09-19T14:00:00.000Z',
    updatedAt: '2026-09-22T11:00:00.000Z',
  },
  {
    id: 'task-4',
    title: 'Интерактивный дашборд анализа когортного оттока клиентов фитнес-сети',
    industry: 'Спорт & Аналитика',
    tags: ['React', 'TypeScript', 'Data Analytics', 'SQL', 'Tailwind'],
    context: 'Сеть из 8 фитнес-клубов теряет до 24% клиентов после первых трех месяцев посещения. Маркетологи не видят корреляции между типами абонементов и визитами.',
    need: 'Построить когортный анализ и визуализировать карту оттока в разрезе филиалов, тренеров и времени суток.',
    targetUsers: 'Управляющие клубами и бренд-маркетологи сети.',
    availableData: 'Таблицы выгрузки посещений за 2 года (анонимизированные ID, даты визитов, тариф, пол, возраст) в SQLite/Postgres.',
    constraints: 'Срок реализации прототипа 14 дней. Фреймворк React/Vite.',
    expectedResult: 'Интерактивный веб-дашборд с фильтрацией по клубам и экспортом отчетов в Excel.',
    successCriteria: 'Скорость фильтрации менее 1 секунды на выборке из 50 000 записей.',
    contact: 'Операционный директор: ops@fitlife.kz',
    consultationFormat: 'Еженедельный созвон в Zoom.',
    confirmedFields: ['title', 'context', 'need', 'targetUsers', 'availableData', 'expectedResult'],
    confirmed: true,
    published: true,
    createdAt: '2026-09-22T08:00:00.000Z',
    updatedAt: '2026-09-23T10:00:00.000Z',
  },
  {
    id: 'task-5',
    title: 'Бот бронирования переговорных комнат в коворкинге',
    industry: 'Admin & Services',
    tags: ['Python', 'Telegram', 'SQLite'],
    context: 'В коворкинге 4 переговорные комнаты. Резиденты постоянно путают слоты бронирования.',
    need: 'Сделать бота для бронирования по тайм-слотам.',
    targetUsers: 'Резиденты коворкинга.',
    availableData: 'Список комнат и расписание работы коворкинга.',
    constraints: 'Телеграм-бот.',
    expectedResult: 'Работающий бот.',
    successCriteria: 'Бронь не пересекается.',
    contact: 'Telegram: @cowork_admin',
    consultationFormat: 'В Telegram.',
    confirmedFields: ['title', 'context', 'need', 'contact'],
    confirmed: true,
    published: true,
    createdAt: '2026-09-23T07:00:00.000Z',
    updatedAt: '2026-09-23T07:00:00.000Z',
  },
];

// Keep catalog cards and the rating inspector on the same scoring formula.
const legacySeedTasks: Task[] = seedTaskInputs.map((input) => {
  const task: Task = { ...input, rating: 0, readinessLevel: 'draft' };
  const rating = calculateRating(task).total;
  return { ...task, rating, readinessLevel: getReadinessLevel(rating) };
});

const legacySeedTeams: Team[] = [
  {
    id: 'team-1',
    name: 'DataWhales (AITU)',
    description: 'Команда магистрантов и старшекурсников Astana IT University, специализирующаяся на машинном обучении, NLP и анализе больших данных.',
    skills: ['Machine Learning', 'Data Science', 'Backend', 'NLP', 'Computer Vision'],
    technologies: ['Python', 'PyTorch', 'FastAPI', 'Pandas', 'Docker', 'PostgreSQL'],
    interests: ['FinTech', 'Cloud & Infrastructure', 'Smart City', 'Data Analytics'],
    industries: ['FinTech', 'Cloud & Infrastructure', 'Smart City & GovTech'],
    progressPoints: 180,
  },
  {
    id: 'team-2',
    name: 'NeuralNomads',
    description: 'Фокусируемся на разработке современных веб-платформ с интеграцией больших языковых моделей и AI-агентов.',
    skills: ['AI Agents', 'Fullstack', 'Frontend', 'UI/UX', 'Cloud Architecture'],
    technologies: ['React', 'TypeScript', 'Next.js', 'Python', 'Tailwind', 'Docker'],
    interests: ['AI', 'EdTech', 'FinTech', 'SaaS'],
    industries: ['FinTech', 'FoodTech & Retail', 'EdTech'],
    progressPoints: 240,
  },
  {
    id: 'team-3',
    name: 'CyberSana',
    description: 'Специалисты по высоконагруженным распределенным сервисам, микросервисам и информационной безопасности.',
    skills: ['Highload', 'Backend', 'System Design', 'InfoSec', 'DevOps'],
    technologies: ['Go', 'Rust', 'Docker', 'PostgreSQL', 'Redis', 'Kubernetes'],
    interests: ['FinTech', 'Cloud & Infrastructure', 'Logistics'],
    industries: ['Cloud & Infrastructure', 'FinTech', 'Логистика & Склад'],
    progressPoints: 150,
  },
  {
    id: 'team-4',
    name: 'FullStackPro',
    description: 'Быстрое прототипирование веб и мобильных приложений с отзывчивым интерфейсом и чистой архитектурой.',
    skills: ['Frontend', 'Mobile Apps', 'UI/UX', 'Rapid Prototyping'],
    technologies: ['React', 'TypeScript', 'Flutter', 'Node.js', 'Tailwind', 'Express'],
    interests: ['Mobile', 'Спорт & Здоровье', 'Retail', 'Smart City'],
    industries: ['Спорт & Здоровье', 'Smart City & GovTech', 'FoodTech & Retail'],
    progressPoints: 95,
  },
  {
    id: 'team-5',
    name: 'CodeCrafters',
    description: 'Команда автоматизации бизнес-процессов: чат-боты, интеграции CRM и парсинг данных.',
    skills: ['Bots', 'Automation', 'Backend', 'API Integration'],
    technologies: ['Python', 'Aiogram', 'SQLite', 'Docker', 'REST API'],
    interests: ['Automation', 'Retail', 'Services', 'CRM'],
    industries: ['Admin & Services', 'FoodTech & Retail', 'Логистика & Склад'],
    progressPoints: 110,
  },
];

const legacySeedProposals: Proposal[] = [
  {
    id: 'prop-1',
    taskId: 'task-1',
    teamId: 'team-1',
    idea: 'Построение двухуровневого ансамбля: быстрый TF-IDF + LogisticRegression для очевидных случаев (80% трафика, latency 15 мс) и дистиллированный multilingual BERT для сложных длинных обращений.',
    implementationPlan: '1. Предобработка логов и аугментация редких классов\n2. Обучение baseline модели и тюнинг гиперпараметров\n3. Сборка легковесного FastAPI микросервиса в Docker\n4. Нагрузочное тестирование до 200 RPS',
    estimatedTime: '10 рабочих дней',
    prototypeUrl: 'https://github.com/datawhales/fintech-classifier-poc',
    status: 'selected',
    createdAt: '2026-09-22T11:00:00.000Z',
  },
  {
    id: 'prop-2',
    taskId: 'task-2',
    teamId: 'team-3',
    idea: 'Реализация высокопроизводительного агента сбора метрик на Go + модуль детекции аномалий с использованием скользящего окна Z-score и Isolation Forest.',
    implementationPlan: '1. Парсинг датасета Parquet и выделение коррелирующих фичей\n2. Реализация алгоритма скользящего окна с адаптивным порогом\n3. Экспорт алертов в формате Prometheus/JSON\n4. Документация и benchmark отчет',
    estimatedTime: '14 рабочих дней',
    prototypeUrl: 'https://github.com/cybersana/datacenter-anomaly-engine',
    status: 'pending',
    createdAt: '2026-09-22T15:30:00.000Z',
  },
  {
    id: 'prop-3',
    taskId: 'task-3',
    teamId: 'team-4',
    idea: 'Кроссплатформенное приложение на Flutter с TFLite инференсом модели YOLOv8n, кэшированием видеофрагментов офлайн и автосинхронизацией по Wi-Fi.',
    implementationPlan: '1. Конвертация весов модели в формат .tflite с FP16 квантованием\n2. Верстка экранов записи инспекции и карты\n3. Фоновая геолокация и привязка меток дефектов\n4. Сборка тестового APK',
    estimatedTime: '18 рабочих дней',
    prototypeUrl: 'https://figma.com/file/road-inspector-preview',
    status: 'pending',
    createdAt: '2026-09-22T17:00:00.000Z',
  },
  {
    id: 'prop-4',
    taskId: 'task-4',
    teamId: 'team-2',
    idea: 'Интерактивный когортный дашборд на React + Recharts с расчетом LTV, Churn rate и тепловой картой посещаемости по часам.',
    implementationPlan: '1. Схема агрегации SQL запросов к SQLite\n2. Компоненты фильтрации по филиалам и когортам\n3. Экспорт графиков в PDF и Excel таблиц\n4. Инструкция по развертыванию',
    estimatedTime: '7 рабочих дней',
    prototypeUrl: 'https://neuralnomads-dashboard.demo.app',
    status: 'selected',
    createdAt: '2026-09-23T09:15:00.000Z',
  },
  {
    id: 'prop-5',
    taskId: 'task-5',
    teamId: 'team-5',
    idea: 'Асинхронный телеграм-бот на Aiogram 3.x с интерактивным календарем выбора дат и слотов, предотвращающий овербукинг через транзакции SQLite.',
    implementationPlan: '1. Проектирование схемы БД слотов брони\n2. Inline-кнопки календаря и выбора времени\n3. Уведомления за 15 минут до начала брони\n4. Развертывание на сервере',
    estimatedTime: '4 рабочих дня',
    prototypeUrl: 'https://t.me/aitu_cowork_bot_demo',
    status: 'rejected',
    createdAt: '2026-09-23T11:00:00.000Z',
  },
];


export function createEmptyTask(draft = '', industry = 'Retail'): Task {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), rawDraft: draft, fieldSources: {},
    title: '', industry, tags: [], context: '', need: '', targetUsers: '',
    availableData: '', constraints: '', expectedResult: '', successCriteria: '',
    contact: '', consultationFormat: '', confirmedFields: [], rating: 0,
    readinessLevel: 'draft', confirmed: false, published: false, createdAt: now, updatedAt: now,
  };
}

export const demoAnswers: Record<string, string> = {
  title: 'Прогнозирование спроса для сети магазинов',
  context: 'Сеть из 12 продуктовых магазинов формирует закупки вручную. Остатки проверяют каждое утро, но популярные товары заканчиваются до поставки.',
  need: 'Прогнозировать спрос на неделю вперёд по каждому магазину и рекомендовать объём закупки с учётом сезонности и акций.',
  targetUsers: 'Пять менеджеров по закупкам и руководители магазинов ежедневно проверяют рекомендации перед отправкой заказа поставщику.',
  availableData: 'Предоставим обезличенную CSV выгрузку продаж за 18 месяцев: дата, магазин, товар, количество, цена, остаток и признак акции.',
  constraints: 'Прототип нужен за 3 недели, бюджет до 200 000 тенге. Только обезличенные данные; развёртывание на внутреннем сервере.',
  expectedResult: 'Работающий прототип панели с недельным прогнозом, рекомендуемыми закупками и выгрузкой результата в CSV для каждого магазина.',
  successCriteria: 'Снизить долю отсутствующих товаров на 20% и получить ошибку прогноза MAPE менее 15% на последнем месяце продаж.',
  contact: 'Айгуль, менеджер продукта — retail@sana.example',
  consultationFormat: 'Созвон в Google Meet по вторникам на 30 минут; ответы на вопросы команды в рабочем чате ежедневно.',
};

function seedTask(id: string, values: Partial<Task>): Task {
  const task: Task = {
    id, title: '', industry: 'Retail', tags: [], context: '', need: '', targetUsers: '',
    availableData: '', constraints: '', expectedResult: '', successCriteria: '', contact: '',
    consultationFormat: '', confirmedFields: [], confirmed: false, published: false,
    rating: 0, readinessLevel: 'draft', createdAt: '2026-09-20T08:00:00.000Z',
    updatedAt: '2026-09-20T08:00:00.000Z', fieldSources: {}, ...values,
  };
  if (task.confirmed) task.confirmedFields = Object.keys(demoAnswers).filter(key => Boolean(task[key as keyof Task]));
  task.rating = calculateRating(task).total;
  task.readinessLevel = getReadinessLevel(task.rating);
  task.fieldSources = Object.fromEntries(Object.keys(demoAnswers).filter(key => Boolean(task[key as keyof Task])).map(key => [key, task.published ? 'manual' : 'draft']));
  return task;
}

const uiSeedTasks: Task[] = [
  seedTask('draft-retail', {
    title: 'Закупки без лишних остатков', industry: 'Retail', tags: ['Python', 'AI', 'Forecasting'],
    rawDraft: 'У нас сеть магазинов. Хотим лучше прогнозировать продажи, чтобы не заказывать лишнее и не терять покупателей. Сейчас всё в Excel.',
    context: 'У нас сеть магазинов, закупки сейчас ведём в Excel.', need: 'Хотим лучше прогнозировать продажи.',
  }),
  seedTask('draft-education', {
    title: 'Раннее выявление оттока студентов', industry: 'Education', tags: ['Python', 'Analytics'],
    rawDraft: 'В учебном центре студенты иногда перестают посещать занятия. Хотим заранее понимать, кому нужна помощь. Есть журнал посещений.',
    context: 'Студенты учебного центра иногда перестают посещать занятия.', need: 'Заранее видеть риск оттока студентов.',
    availableData: 'Журнал посещений',
  }),
  seedTask('draft-healthcare', {
    title: 'Очередь в регистратуре', industry: 'Healthcare', tags: ['React', 'UX/UI'],
    rawDraft: 'Пациенты больницы долго ждут в регистратуре. Нужна электронная очередь, чтобы администраторы видели нагрузку. Детали ещё обсуждаем.',
    context: 'Пациенты больницы долго ждут при записи к врачу.', need: 'Улучшить работу регистратуры.',
  }),
  seedTask('draft-logistics', {
    title: 'Маршруты для курьеров', industry: 'Logistics', tags: ['Python', 'Optimization'],
    rawDraft: 'Курьеры доставляют заказы по городу, маршруты составляем вручную. Нужен инструмент для диспетчера. Есть адреса доставок и время выезда.',
    context: 'Диспетчер вручную составляет маршруты по городу.', need: 'Оптимизировать маршруты доставки.',
    targetUsers: 'Диспетчеры службы доставки',
  }),
  seedTask('draft-fintech', {
    title: 'Сортировка входящих документов', industry: 'FinTech', tags: ['Python', 'NLP'],
    rawDraft: 'Сотрудники вручную раскладывают документы по типам. Хотим автоматическую классификацию и проверку. Документы нельзя передавать наружу.',
    context: 'Сотрудники вручную сортируют входящие документы.', need: 'Автоматизировать классификацию документов.',
    constraints: 'Документы нельзя передавать внешним сервисам.',
  }),
  seedTask('task-retail', {
    ...demoAnswers, id: 'task-retail', industry: 'Retail', tags: ['Python', 'AI', 'Analytics', 'Forecasting', 'Power BI'],
    confirmed: true, published: true, createdAt: '2026-09-21T09:00:00.000Z', updatedAt: '2026-09-21T09:00:00.000Z',
  }),
  seedTask('task-education', {
    title: 'Кому нужна помощь в учёбе', industry: 'Education', tags: ['Python', 'SQL', 'Analytics', 'AI'],
    context: 'Учебный центр ведёт 40 групп. Кураторы замечают снижение посещаемости только перед итоговой аттестацией, когда помочь уже сложнее.',
    need: 'Выявлять студентов с риском оттока и давать куратору объяснимые сигналы для своевременной личной поддержки.',
    targetUsers: 'Восемь кураторов групп ежедневно просматривают список студентов и назначают индивидуальные встречи.',
    availableData: 'Предоставим обезличенные SQL таблицы посещаемости, оценок и обращений за 12 месяцев, доступ через защищённую выгрузку.',
    constraints: '',
    expectedResult: 'Панель куратора с объяснением факторов риска, фильтром по группам и экспортом списка для дальнейшей работы.',
    successCriteria: 'Снизить отток студентов на 15% в пилотных группах за один семестр.',
    contact: 'Динара — education@sana.example', consultationFormat: 'Еженедельный созвон',
    confirmed: true, published: true, createdAt: '2026-09-19T09:00:00.000Z',
  }),
  seedTask('task-healthcare', {
    title: 'Электронная очередь для поликлиники', industry: 'Healthcare', tags: ['React', 'TypeScript', 'UX/UI', 'Web'],
    context: 'В больнице три окна регистрации. Утром очередь распределяется неравномерно, администратор не видит общей загрузки.',
    need: 'Сделать очередь прозрачной для пациентов и помочь администратору распределять поток между окнами.',
    targetUsers: 'Администраторы регистратуры и пациенты поликлиники используют экран очереди и рабочую панель.',
    availableData: 'Журнал обращений',
    constraints: 'Не собирать персональные данные пациентов.',
    expectedResult: 'Прототип веб-приложения для выдачи талонов, вызова пациента и показа текущей очереди на общем экране.',
    successCriteria: 'Уменьшить время ожидания.', contact: 'Марат — clinic@sana.example', consultationFormat: '',
    confirmed: true, published: true, createdAt: '2026-09-18T10:00:00.000Z',
  }),
  seedTask('task-logistics', {
    title: 'Планирование городских доставок', industry: 'Logistics', tags: ['Python', 'Optimization', 'Analytics'],
    context: 'Небольшая служба доставки составляет маршруты вручную.', need: 'Оптимизировать доставку по городу.',
    targetUsers: 'Диспетчер', contact: 'logistics@sana.example', confirmed: true, published: true,
    createdAt: '2026-09-22T13:00:00.000Z', updatedAt: '2026-09-22T13:00:00.000Z',
  }),
  seedTask('task-fintech', {
    title: 'Классификация финансовых документов', industry: 'FinTech', tags: ['Python', 'FastAPI', 'NLP', 'Docker', 'AI'],
    context: 'Финансовый отдел получает 600 документов в день. Специалисты вручную определяют тип и направляют файл ответственному сотруднику.',
    need: 'Автоматизировать классификацию документов и выделять неуверенные предсказания для ручной проверки специалистом.',
    targetUsers: 'Специалисты финансового отдела загружают документы, проверяют тип и передают их дальше по внутреннему процессу.',
    availableData: 'Доступны 5000 обезличенных PDF документов с метками классов; предоставим архив после согласования перечня файлов.',
    constraints: 'Работа только на локальном сервере, без внешних AI API. Срок прототипа 4 недели.',
    expectedResult: 'Прототип FastAPI сервиса классификации с оценкой уверенности и небольшой панелью для проверки результатов специалистом.',
    successCriteria: 'Точность классификации не менее 92% на отложенной выборке, время обработки документа менее 3 секунд.',
    contact: 'Аслан — fintech@sana.example',
    consultationFormat: 'Созвон с финансовым аналитиком по средам на 45 минут и ответы в чате в течение рабочего дня.',
    confirmed: true, published: true, createdAt: '2026-09-20T15:00:00.000Z',
  }),
];

const uiSeedTeams: Team[] = [
  {
    id: 'team-neuralforge', name: 'NeuralForge',
    description: 'Строим объяснимые модели и превращаем исследования в работающие сервисы. Сильны в обработке текста и прогнозировании.',
    skills: ['AI', 'NLP', 'Forecasting', 'Analytics'], technologies: ['Python', 'FastAPI', 'React', 'SQL'],
    interests: ['AI', 'NLP', 'Forecasting', 'FinTech'], industries: ['FinTech', 'Retail'], progressPoints: 0,
  },
  {
    id: 'team-bytecrew', name: 'ByteCrew',
    description: 'Делаем удобные веб-приложения: от интервью с пользователями и прототипа до готового интерфейса.',
    skills: ['Web', 'UX/UI', 'Analytics'], technologies: ['React', 'TypeScript', 'Node.js', 'Figma'],
    interests: ['Web', 'UX/UI', 'Healthcare', 'Education'], industries: ['Healthcare', 'Education'], progressPoints: 0,
  },
  {
    id: 'team-datalab', name: 'DataLab',
    description: 'Помогаем принимать решения на основе данных. Аналитика, прогнозы и понятные панели для бизнеса.',
    skills: ['Analytics', 'Forecasting', 'AI'], technologies: ['Python', 'SQL', 'Power BI', 'Pandas'],
    interests: ['Analytics', 'Forecasting', 'AI', 'Retail', 'Education'], industries: ['Retail', 'Education'], progressPoints: 0,
  },
  {
    id: 'team-routeworks', name: 'RouteWorks',
    description: 'Решаем задачи распределения ресурсов и построения маршрутов. Проверяем алгоритмы на реальных ограничениях.',
    skills: ['Optimization', 'Analytics', 'Forecasting'], technologies: ['Python', 'PostgreSQL', 'Docker', 'FastAPI'],
    interests: ['Optimization', 'Analytics', 'Logistics'], industries: ['Logistics', 'Retail'], progressPoints: 0,
  },
  {
    id: 'team-eduspark', name: 'EduSpark',
    description: 'Создаём инструменты для преподавателей и кураторов. Соединяем исследование пользователей и анализ учебных данных.',
    skills: ['Analytics', 'AI', 'Web', 'UX/UI'], technologies: ['Python', 'SQL', 'React', 'TypeScript'],
    interests: ['Education', 'Analytics', 'AI', 'UX/UI'], industries: ['Education'], progressPoints: 0,
  },
];

const uiSeedProposals: Proposal[] = [
  {
    id: 'proposal-retail-neural', taskId: 'task-retail', teamId: 'team-neuralforge',
    idea: 'Построим модель прогноза по магазинам и товарам, сравним её с сезонным baseline и покажем причины рекомендации.',
    implementationPlan: '1. Проверка качества продаж. 2. Временная валидация и baseline. 3. Модель спроса. 4. Панель и демонстрация менеджерам.',
    estimatedTime: '3 недели', prototypeUrl: '', status: 'pending', createdAt: '2026-09-21T12:00:00.000Z',
  },
  {
    id: 'proposal-retail-data', taskId: 'task-retail', teamId: 'team-datalab',
    idea: 'Начнём с прозрачной статистической модели и панели Power BI. Покажем прогноз, интервалы и ожидаемый дефицит.',
    implementationPlan: 'Проверим выгрузку, подготовим витрину, обучим модели по категориям и проведём пилот на двух магазинах.',
    estimatedTime: '18 дней', prototypeUrl: 'https://github.com/topics/demand-forecasting', status: 'pending', createdAt: '2026-09-21T14:30:00.000Z',
  },
  {
    id: 'proposal-health-byte', taskId: 'task-healthcare', teamId: 'team-bytecrew',
    idea: 'Сделаем простой интерфейс оператора и контрастное табло очереди, которое работает без персональных данных.',
    implementationPlan: 'Интервью с регистратурой, кликабельный прототип, React приложение, тест в одном окне и доработка сценариев.',
    estimatedTime: '2 недели', prototypeUrl: '', status: 'pending', createdAt: '2026-09-20T11:00:00.000Z',
  },
  {
    id: 'proposal-logistics-route', taskId: 'task-logistics', teamId: 'team-routeworks',
    idea: 'Уточним ограничения доставки и сравним маршруты диспетчера с оптимизацией по времени и вместимости машины.',
    implementationPlan: 'Соберём примеры маршрутов, согласуем окна доставки, реализуем оптимизатор и проверим на одной рабочей неделе.',
    estimatedTime: '3 недели после уточнения данных', prototypeUrl: 'https://github.com/google/or-tools', status: 'pending', createdAt: '2026-09-22T15:00:00.000Z',
  },
  {
    id: 'proposal-education-spark', taskId: 'task-education', teamId: 'team-eduspark',
    idea: 'Покажем куратору факторы риска и возможность отметить полезность сигнала, без автоматических решений о студенте.',
    implementationPlan: 'Согласуем признаки, исключим утечки данных, обучим baseline, сделаем панель и соберём обратную связь кураторов.',
    estimatedTime: '4 недели', prototypeUrl: '', status: 'pending', createdAt: '2026-09-20T16:00:00.000Z',
  },
  {
    id: 'proposal-fintech-neural', taskId: 'task-fintech', teamId: 'team-neuralforge',
    idea: 'Локальный NLP классификатор с порогом уверенности; сложные документы направляем специалисту на проверку.',
    implementationPlan: 'Аудит разметки, выделение текста, сравнение моделей, FastAPI сервис, нагрузочная проверка и документация.',
    estimatedTime: '4 недели', prototypeUrl: '', status: 'pending', createdAt: '2026-09-21T10:00:00.000Z',
  },
];

// Keep the original platform fixtures and the richer UI demo under their stable IDs.
export const seedTasks: Task[] = [...legacySeedTasks, ...uiSeedTasks];
export const seedTeams: Team[] = [...legacySeedTeams, ...uiSeedTeams];
export const seedProposals: Proposal[] = [...legacySeedProposals, ...uiSeedProposals];

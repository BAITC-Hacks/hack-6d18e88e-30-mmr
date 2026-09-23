import type { Task } from '../types/task';
import type { Team } from '../types/team';
import type { Proposal } from '../types/proposal';
import { calculateRating, getReadinessLevel } from '../services/ratingService.ts';

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
  task.rating = calculateRating(task).total;
  task.readinessLevel = getReadinessLevel(task.rating);
  if (task.confirmed) task.confirmedFields = Object.keys(demoAnswers).filter(key => Boolean(task[key as keyof Task]));
  task.fieldSources = Object.fromEntries(Object.keys(demoAnswers).filter(key => Boolean(task[key as keyof Task])).map(key => [key, task.published ? 'manual' : 'draft']));
  return task;
}

export const seedTasks: Task[] = [
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
    rawDraft: 'Пациенты долго ждут в регистратуре. Нужна электронная очередь, чтобы администраторы видели нагрузку. Детали ещё обсуждаем.',
    context: 'Пациенты долго ждут при записи к врачу.', need: 'Улучшить работу регистратуры.',
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
    context: 'В поликлинике три окна регистрации. Утром очередь распределяется неравномерно, администратор не видит общей загрузки.',
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

export const seedTeams: Team[] = [
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

export const seedProposals: Proposal[] = [
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

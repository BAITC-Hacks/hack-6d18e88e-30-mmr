import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Drives rendered production UI, never imports the store or alters task state. */
export async function auditBrowser({ evaluate, command, delay, outputDirectory, name }) {
  const checks = [];
  const screenshots = [];
  const state = () => evaluate("JSON.parse(localStorage.getItem('ai-sana-taskrank-v1')).state");
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`UI condition timed out: ${expression}`);
  };
  const click = async selector => {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (element.disabled) throw new Error('Cannot click disabled control');
      element.scrollIntoView({block:'center', inline:'center'});
      const box = element.getBoundingClientRect();
      return {x:box.x + box.width/2, y:box.y + box.height/2};
    })()`);
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    await delay(130);
  };
  const button = async (text, scope = 'body') => {
    const marked = await evaluate(`(() => {
      const buttons = [...document.querySelector(${JSON.stringify(scope)}).querySelectorAll('button')];
      const element = buttons.find(button => button.textContent.trim().startsWith(${JSON.stringify(text)}));
      if (!element) return false;
      element.setAttribute('data-audit-click', 'current'); return true;
    })()`);
    assert.ok(marked, `Visible button: ${text}`);
    await click('[data-audit-click="current"]');
    await evaluate("document.querySelector('[data-audit-click]')?.removeAttribute('data-audit-click')");
  };
  const snapshot = async label => {
    await evaluate('document.fonts.ready.then(() => true)');
    // Capture the settled interface, not a frame in the auth enter animation.
    await evaluate('Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))).then(() => true)');
    const metrics = await evaluate(`({width:document.documentElement.clientWidth, documentWidth:document.documentElement.scrollWidth,
      dialogs:[...document.querySelectorAll('dialog[open]')].map(el=>({width:el.clientWidth, scroll:el.scrollWidth})),
      clippedHeadings:[...document.querySelectorAll('h1,h2,h3')].filter(el=>el.clientWidth && el.scrollWidth > el.clientWidth+1).map(el=>el.textContent),
      overflowing:[...document.querySelectorAll('main *')].filter(el=>el.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(0,15).map(el=>({tag:el.tagName,className:el.className,right:el.getBoundingClientRect().right})),
      broken:[...document.images].filter(el=>el.complete&&!el.naturalWidth).length})`);
    const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const target = path.join(outputDirectory, `${name}-${label}.png`);
    await writeFile(target, Buffer.from(data, 'base64'));
    screenshots.push(target);
    assert.ok(metrics.documentWidth <= metrics.width + 1, `${label}: page fits viewport ${JSON.stringify(metrics)}`);
    assert.ok(metrics.dialogs.every(item => item.scroll <= item.width + 1), `${label}: dialog fits viewport`);
    assert.deepEqual(metrics.clippedHeadings, [], `${label}: headings fit their containers`);
    assert.equal(metrics.broken, 0, `${label}: images load`);
  };
  const demo = step => click(`.demo-step:nth-child(${step})`);
  await snapshot('overview');
  await demo(1);
  await waitFor("Boolean(document.querySelector('#draft-input'))");
  await demo(2);
  await waitFor("document.querySelectorAll('.clarification-question').length >= 3");
  await snapshot('questions');
  checks.push('real HTTP analysis returned at least three clarification questions');
  await demo(3);
  await button('Заполнить примерные ответы');
  assert.equal((await state()).tasks.find(item => item.id === 'demo-task').rating, 0);
  await button('Продолжить к карточке');
  await snapshot('editor');
  assert.equal(await evaluate("document.querySelectorAll('[id^=task-field-]').length"), 10);
  await button('Проверить готовность');
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(el=>el.textContent.includes('Подтвердить карточку')).disabled"), true);
  await click('.consent-field input');
  await button('Подтвердить карточку');
  let saved = await state();
  assert.equal(saved.tasks.find(item => item.id === 'demo-task').rating, 100);
  assert.equal(saved.tasks.find(item => item.id === 'demo-task').published, false);
  await button('Перейти к публикации');
  await button('Опубликовать задачу');
  assert.equal((await state()).tasks.find(item => item.id === 'demo-task').published, true);
  checks.push('ten editable fields, consent, 0→100 confirmed rating, explicit publication');
  await demo(6);
  await waitFor("Boolean(document.querySelector('dialog[open] form'))");
  await snapshot('proposal');
  const before = await state();
  await button('Заполнить пример', 'dialog[open]');
  await button('Отправить предложение', 'dialog[open]');
  saved = await state();
  const proposal = saved.proposals.find(item => !before.proposals.some(old => old.id === item.id));
  assert.ok(proposal);
  assert.equal(proposal.taskId, 'demo-task');
  assert.equal(proposal.status, 'pending');
  const baseline = saved.teams.find(item => item.id === proposal.teamId).progressPoints;
  await demo(7);
  await button('Выбрать команду', '.business-proposal');
  assert.equal((await state()).proposals.find(item => item.id === proposal.id).status, 'selected');
  await demo(8);
  assert.ok(await evaluate("document.querySelector('h1').getBoundingClientRect().top >= 0"), 'New screen starts at its heading after a long form');
  await snapshot('milestones');
  const first = (await state()).milestones.find(item => item.taskId === 'demo-task' && item.teamId === proposal.teamId);
  await button('Подтвердить этап');
  assert.equal((await state()).teams.find(item => item.id === proposal.teamId).progressPoints, baseline + first.points);
  await command('Page.reload', { ignoreCache: true });
  await waitFor("Boolean(document.querySelector('.app-shell'))");
  saved = await state();
  assert.equal(saved.tasks.find(item => item.id === 'demo-task').published, true);
  assert.equal(saved.teams.find(item => item.id === proposal.teamId).progressPoints, baseline + first.points);
  assert.equal(saved.milestones.find(item => item.id === first.id).status, 'completed');
  checks.push('proposal, manual selection, milestone award and persistence across real reload');
  await button('Мои задачи', '.sidebar');
  await snapshot('my-tasks');
  await button('Редактировать');
  await waitFor("Boolean(document.querySelector('.builder-stepper'))");
  await snapshot('published-editor');
  checks.push('published task opens in editor from My Tasks');
  await button('AI Inspector', '.sidebar');
  await waitFor("!document.body.textContent.includes('Загружаем описание AI с сервера…')");
  assert.equal(await evaluate("document.body.textContent.includes('Prompt и схема получены с сервера')"), true);
  await snapshot('inspector');
  checks.push('Inspector loads the actual server prompt API');
  await button('Студент', '.role-switch');
  await button('Каталог задач', '.sidebar');
  await button('Подробнее', '.task-card');
  await snapshot('task-details');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor("!document.querySelector('dialog[open]')");
  assert.equal(await evaluate('document.body.style.overflow'), '');
  checks.push('native modal Escape closes and restores page scrolling');
  await button('Мои отклики', '.sidebar');
  await snapshot('my-proposals');
  await button('Моя команда', '.sidebar');
  await snapshot('team');
  for (const theme of ['atelier', 'index', 'signal']) {
    await button('Дизайн-системы', '.sidebar');
    await click(`[data-theme-choice="${theme}"]`);
    await snapshot(`design-${theme}`);
    await click('[data-apply-design]');
    await waitFor("Boolean(document.querySelector('.app-shell'))");
    assert.equal(await evaluate('document.documentElement.dataset.design'), theme);
    assert.equal((await state()).tasks.find(item => item.id === 'demo-task').published, true);
    await snapshot(`theme-${theme}`);
  }
  checks.push('all three design previews and applied themes preserve task data');
  await button('Бизнес', '.role-switch');
  const url = await evaluate('location.href');
  const { targetId: otherTarget } = await command('Target.createTarget', { url: 'about:blank' }, null);
  try {
    const { sessionId: otherSession } = await command('Target.attachToTarget', { targetId: otherTarget, flatten: true }, null);
    await command('Page.enable', {}, otherSession);
    await command('Runtime.enable', {}, otherSession);
    await command('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, otherSession);
    const inOtherTab = async expression => {
      const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, otherSession);
      if (result.exceptionDetails) throw new Error('Second browser tab failed');
      return result.result.value;
    };
    await command('Page.navigate', { url }, otherSession);
    let rendered = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await inOtherTab("Boolean(document.querySelector('.role-switch'))")) { rendered = true; break; }
      await delay(100);
    }
    assert.ok(rendered, 'Second tab renders the earlier snapshot');
    const oldIds = (await state()).tasks.map(task => task.id);
    await button('Создать задачу', '.sidebar');
    const newTask = (await state()).tasks.find(task => !oldIds.includes(task.id));
    assert.ok(newTask, 'First tab creates a new task after second tab loaded');
    const point = await inOtherTab(`(() => {
      const button = [...document.querySelectorAll('.role-switch button')].find(el=>el.textContent === 'Студент');
      button.scrollIntoView({block:'center'}); const box = button.getBoundingClientRect();
      return {x:box.x+box.width/2,y:box.y+box.height/2};
    })()`);
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }, otherSession);
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }, otherSession);
    await delay(150);
    assert.ok(await inOtherTab("document.querySelector('.storage-warning')?.textContent.includes('другой вкладке')"));
    assert.ok((await state()).tasks.some(task => task.id === newTask.id), 'Stale tab did not erase the new task');
    checks.push('two real browser tabs preserve newer work and display the storage conflict');
  } finally {
    await command('Target.closeTarget', { targetId: otherTarget }, null);
  }
  await button('Аккаунт', '.sidebar');
  await waitFor("location.pathname === '/auth' && !document.body.textContent.includes('Открываем аккаунт…')");
  await snapshot('auth');
  checks.push('student pages and account render without layout overflow');
  return { checks, screenshots };
}

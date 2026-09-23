import { createRequire } from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const React = require('react');
const { act } = React;
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {url:'http://localhost:5173/'});
const {window} = dom;
for (const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,localStorage:window.localStorage,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,Event:window.Event,MouseEvent:window.MouseEvent,requestAnimationFrame:cb=>setTimeout(()=>cb(performance.now()),0),cancelAnimationFrame:clearTimeout,IS_REACT_ACT_ENVIRONMENT:true})) Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
window.HTMLElement.prototype.scrollIntoView = function(){};
let requests = 0;
globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify({detectedFields:{},missingFields:[],questions:[],provider:'stub',fallbackUsed:true}));};
const {analyzeDraft}=await import('../../frontend/src/services/aiClient.ts');
const cafe='В кафе каждый вечер списываем выпечку. Хотим предсказывать, сколько печь завтра';
const doctor='Нужна электронная очередь к врачу';
for (const draft of [cafe, doctor]) {
  const before=requests;
  try {const result=await analyzeDraft(draft,'Retail');console.log(JSON.stringify({test:'scope',draft,result:'allowed',questions:result.questions.length,networkRequests:requests-before}));}
  catch(error){console.log(JSON.stringify({test:'scope',draft,result:error.code,networkRequests:requests-before}));}
}
const {createRoot}=require('react-dom/client');
const {TaskBuilder}=await import('../../frontend/src/features/builder/TaskBuilder.tsx');
const {useAppStore}=await import('../../frontend/src/app/store.ts');
const {createEmptyTask}=await import('../../frontend/src/data/syntheticData.ts');
const initial={...createEmptyTask(),rawDraft:'Наш бизнес хочет автоматизировать учет заказов. Контакт: old@example.com'};
useAppStore.getState().addTask(initial);
useAppStore.getState().setActiveTask(initial.id);
const root=createRoot(window.document.getElementById('root'));
await act(async()=>root.render(React.createElement(TaskBuilder)));
const btn=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(text));
await act(async()=>btn('Проанализировать с AI').click());
const first=useAppStore.getState().tasks.find(t=>t.id===initial.id);
console.log(JSON.stringify({test:'first-analysis',contact:first.contact,source:first.fieldSources.contact}));
await act(async()=>btn('Назад').click());
const field=document.getElementById('draft-input');
await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(field,'Наш бизнес хочет автоматизировать учет заказов.');field.dispatchEvent(new window.Event('input',{bubbles:true}));});
await act(async()=>btn('Проанализировать с AI').click());
const next=useAppStore.getState().tasks.find(t=>t.id===initial.id);
console.log(JSON.stringify({test:'second-analysis',rawDraft:next.rawDraft,contact:next.contact,source:next.fieldSources.contact,removedContactStillPresent:next.contact==='old@example.com'}));
await act(async()=>root.unmount());
window.close();

import { useRef, useState } from 'react';
import { useAppStore } from '../../app/store';
import { createEmptyTask } from '../../data/syntheticData';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { Icon } from '../../components/Icon';
import { useAiInspectorStore } from '../../services/aiClient';
import { resetBuilderSessions } from '../builder/builderSessions';
const labels = ['Черновик','AI','Рейтинг','Каталог','Студент','Отклик','Выбор','Этапы'];
export function DemoBar() {
  const s = useAppStore();
  const [resetOpen,setResetOpen] = useState(false);
  const stepRun = useRef(0);
  if (!s.demoEnabled) return null;
  function step(value:number) {
    const state = useAppStore.getState();
    const run = ++stepRun.current;
    const replayProposal = value === 6 && state.demoStep === 6;
    if (replayProposal) state.setDemoStep(0);
    let demo = state.tasks.find(t=>t.id==='demo-task');
    if (value<=3) {
      state.setActiveRole('business');
      if (!demo) { demo = {...createEmptyTask('Мы хотим прогнозировать спрос в наших магазинах, чтобы сократить списания.','Retail'), id:'demo-task',title:'Прогнозирование спроса в магазинах'}; state.addTask(demo); }
      state.setActiveTask(demo.id); state.navigate('builder');
    } else {
      const active = state.tasks.find(t=>t.id===state.activeTaskId && t.published);
      let task = active ?? (demo?.published ? demo : state.tasks.find(t=>t.published));
      const teamId = state.activeTeamId ?? state.teams[0]?.id;
      if (value===6) {
        const targetTaskId = task?.id;
        if (targetTaskId && state.proposals.some(p=>p.taskId===targetTaskId && p.teamId===teamId)) {
          const available = state.tasks.find(t=>t.published && !state.proposals.some(p=>p.taskId===t.id && p.teamId===teamId));
          if (available) task = available;
        }
      }
      state.setActiveRole(value === 5 || value === 6 ? 'student' : 'business');
      if (teamId && (value === 5 || value === 6)) state.setActiveTeam(teamId);
      if (task) state.setActiveTask(task.id);
      state.navigate(value >= 7 ? 'proposals' : value === 5 ? 'recommendations' : 'catalog');
      if (!task) state.notify('Сначала подтвердите и опубликуйте задачу — затем продолжите демонстрацию.');
    }
    if (replayProposal) {
      requestAnimationFrame(() => {
        const current = useAppStore.getState();
        if (stepRun.current === run && current.activeRole === 'student' && current.page === 'catalog') current.setDemoStep(6);
      });
    } else state.setDemoStep(value);
  }
  return <><section className="demo-bar" aria-label="Демонстрационный сценарий"><div className="demo-title">DEMO MODE<small>Весь путь за 8 шагов</small></div><div className="demo-steps">{labels.map((label,i)=><button className={`demo-step ${s.demoStep===i+1?'active':''}`} aria-current={s.demoStep===i+1?'step':undefined} key={label} onClick={()=>step(i+1)}><span>{i+1}</span>{label}</button>)}</div><div className="demo-reset"><Button variant="ghost" onClick={()=>setResetOpen(true)} aria-label="Сбросить демо-данные"><Icon name="reset" size={16}/>Сброс</Button></div></section><Modal open={resetOpen} onClose={()=>setResetOpen(false)} title="Сбросить демо-данные?"><p>Созданные в этом браузере задачи, отклики и прогресс будут заменены исходным демонстрационным набором.</p><div className="button-row"><Button variant="secondary" onClick={()=>setResetOpen(false)}>Отмена</Button><Button variant="danger" onClick={()=>{resetBuilderSessions();useAiInspectorStore.getState().clear();s.resetDemo();setResetOpen(false);}}>Сбросить данные</Button></div></Modal></>;
}

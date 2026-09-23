import { useAppStore } from '../../app/store';

export function TeamSelector() {
  const { teams, activeTeamId, setActiveTeam } = useAppStore();
  const team = teams.find((item) => item.id === activeTeamId);
  return <section className="team-selector" aria-label="Выбор активной команды">
    <label className="field"><span>АКТИВНАЯ КОМАНДА</span><select value={activeTeamId ?? ''} onChange={(event) => setActiveTeam(event.target.value || null)}><option value="" disabled>Выберите команду</option>{teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className="team-selector-skills"><span className="muted">{team?.description ?? 'Выберите команду для персональных рекомендаций.'}</span>{team && <div className="tags">{team.technologies.map((technology) => <span className="badge tag" key={technology}>{technology}</span>)}</div>}</div>
    {team && <div className="team-points"><strong>{team.progressPoints}</strong><span>баллов прогресса</span></div>}
  </section>;
}

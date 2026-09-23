import { calculateRating } from '../../services/ratingService';
import type { Task } from '../../types/task';
import { ReadinessBadge } from '../../components/Badge';
import { ScoreRing } from '../../components/ScoreRing';
import { ProgressBar } from '../../components/ProgressBar';
import { RATING_CATEGORIES } from '../../app/constants';

export function RatingPanel({ task, onImprove }: { task: Task; onImprove?: (field: string) => void }) {
  const rating = calculateRating(task);
  return <aside className="panel rating-panel" aria-label="Рейтинг готовности задачи">
    <div className="section-heading"><span className="eyebrow">TASKRANK</span><span className="muted">7 критериев</span></div>
    <div className="rating-summary" aria-live="polite" aria-atomic="true">
      <ScoreRing score={rating.total} size={130} />
      <div><h2>Готовность задачи</h2><ReadinessBadge score={rating.total} /></div>
    </div>
    <p className="muted">Оценка полноты карточки. Меняется сразу после редактирования.</p>
    <div className="rating-categories">
      {RATING_CATEGORIES.map(({ key, label, max: maximum }) => <div className="rating-category" key={key}>
        <div className="section-heading"><span>{label}</span><strong>{rating[key]}<span className="muted"> / {maximum}</span></strong></div>
        <ProgressBar value={rating[key]} max={maximum} />
      </div>)}
    </div>
    <div className="rating-improvements">
      <h3>Как повысить рейтинг</h3>
      {rating.recommendations.length ? <>
        <p className="muted">Потенциал карточки — {rating.potentialTotal}/100</p>
        <ul className="recommendation-list">
          {rating.recommendations.map((recommendation) => <li key={recommendation.field}>
            {onImprove ? <button type="button" onClick={() => onImprove(recommendation.field)}><span className="gain">+{recommendation.possibleGain}</span><span>{recommendation.message}</span><span aria-hidden="true">↗</span></button>
              : <div><span className="gain">+{recommendation.possibleGain}</span><span>{recommendation.message}</span></div>}
          </li>)}
        </ul>
      </> : <p className="notice">Все критерии заполнены. Проверьте сведения перед публикацией.</p>}
    </div>
  </aside>;
}

export default RatingPanel;

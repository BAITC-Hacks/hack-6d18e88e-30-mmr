import type { ReactNode } from 'react';
import { Icon } from '../Icon';
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <div className="empty-state"><Icon name="folder" size={32} /><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>; }

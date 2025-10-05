import type { FC } from 'react';
import { Landmark, Building, Calendar } from 'lucide-react';
import type { EventBranch } from '@/lib/types';

interface EventIconProps {
  branch: EventBranch;
  className?: string;
}

const iconMap: Record<EventBranch, React.ElementType> = {
  Senate: Landmark,
  'House of Representatives': Building,
};

const EventIcon: FC<EventIconProps> = ({ branch, className }) => {
  const IconComponent = iconMap[branch] || Calendar;
  return <IconComponent className={className} />;
};

export default EventIcon;

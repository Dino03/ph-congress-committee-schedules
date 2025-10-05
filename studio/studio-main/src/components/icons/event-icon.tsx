import type { FC } from 'react';
import {
  Briefcase,
  CakeSlice,
  Users,
  User,
  HeartPulse,
  Landmark,
  Building,
} from 'lucide-react';
import type { EventCategory } from '@/lib/types';

interface EventIconProps {
  category: EventCategory;
  className?: string;
}

const iconMap: Record<EventCategory, React.ElementType> = {
  work: Briefcase,
  social: Users,
  birthday: CakeSlice,
  personal: User,
  health: HeartPulse,
  senate: Landmark,
  house: Building,
};

const EventIcon: FC<EventIconProps> = ({ category, className }) => {
  const IconComponent = iconMap[category] || Briefcase;
  return <IconComponent className={className} />;
};

export default EventIcon;

import type { DeviceUsage } from '@/services/api/deviceUsage';
import { groupUsageByPerson, personNames, sumMetrics } from '@/features/deviceUsage/timeline';
import { costValue } from '@/features/deviceUsage/cost';

export function todaySummary(data: DeviceUsage) {
  const grouped = groupUsageByPerson(data);
  const people = personNames.map((name, index) => ({
    ...sumMetrics(grouped.clients.filter((row) => row.client === name)),
    name,
    colorIndex: index,
    initials: { Dan: 'DA', Denis: 'DE', Hlib: 'HL', Dima: 'DI' }[name],
  }));
  people.sort((a, b) => (costValue(b) ?? 0) - (costValue(a) ?? 0) || a.colorIndex - b.colorIndex);
  return {
    people,
    total: sumMetrics(people),
    apps: sumMetrics(
      grouped.clients.filter((row) => !personNames.some((name) => name === row.client))
    ),
    maxCost: Math.max(0, ...people.map((row) => costValue(row) ?? 0)),
  };
}

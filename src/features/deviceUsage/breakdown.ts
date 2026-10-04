import type { DeviceUsage } from '@/services/api/deviceUsage';
import { sumMetrics } from './timeline';

export function personModelRows(data: DeviceUsage, selected: string[]) {
  if (!data.client_models) return undefined;
  return data.clients
    .filter((person) => selected.includes(person.client))
    .map((person) => {
      const models = data
        .client_models!.filter((row) => row.client === person.client)
        .sort((a, b) => b.executions - a.executions || a.model.localeCompare(b.model));
      const providers = [...new Set(models.map((row) => row.provider))].sort().map((provider) => {
        const totals = sumMetrics(models.filter((row) => row.provider === provider));
        return { provider, executions: totals.executions };
      });
      const attempts = providers.reduce((sum, row) => sum + row.executions, 0);
      return {
        ...person,
        models,
        providers: providers.map((row) => ({
          ...row,
          share: attempts ? row.executions / attempts : 0,
        })),
      };
    });
}

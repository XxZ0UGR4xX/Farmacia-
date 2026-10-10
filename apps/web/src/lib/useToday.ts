import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { todayInputValue } from './format';

/**
 * "Hoy" según la zona horaria de la farmacia (la define el servidor). Mientras carga,
 * o si no hay conexión, usa la fecha del equipo.
 */
export function useToday(): string {
  const clock = useQuery({
    queryKey: ['settings', 'clock'],
    queryFn: ({ signal }) => api.get<{ today: string; timeZone: string }>('/settings/clock', { signal }),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  return clock.data?.today ?? todayInputValue();
}

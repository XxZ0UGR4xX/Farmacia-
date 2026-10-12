import { Spinner } from './Spinner';

/** Indicador mientras se descarga el código de un módulo o se cargan sus datos. */
export function PageLoader() {
  return (
    <div className="flex justify-center py-16 text-brand-600">
      <Spinner />
    </div>
  );
}

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

/** Muestra UNA vez la contraseña temporal para entregarla al usuario. */
export function TemporaryPasswordDialog({
  data,
  onClose,
}: {
  data: { email: string; fullName: string; password: string; title: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles: el usuario puede seleccionarla manualmente
    }
  };

  return (
    <Modal
      open={data !== null}
      onClose={onClose}
      title={data?.title ?? ''}
      size="sm"
      footer={
        <Button onClick={onClose} data-autofocus>
          Listo, ya la entregué
        </Button>
      }
    >
      {data && (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            Entrega esta contraseña temporal a <span className="font-medium text-slate-900">{data.fullName}</span> (
            {data.email}). Al entrar, el sistema le pedirá crear su propia contraseña.
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <code className="flex-1 select-all break-all font-mono text-lg tracking-wider text-slate-900">
              {data.password}
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={copy}
              icon={copied ? <Check className="size-4 text-brand-600" /> : <Copy className="size-4" />}
            >
              {copied ? 'Copiada' : 'Copiar'}
            </Button>
          </div>
          <Alert tone="warning">
            Por seguridad no se volverá a mostrar. Si se pierde, usa "Restablecer contraseña".
          </Alert>
        </div>
      )}
    </Modal>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

/**
 * Escaneo de códigos de barras con la cámara del equipo (celular, tablet o webcam).
 * La librería de lectura se carga sólo al abrir el escáner. La imagen no se guarda ni se envía:
 * se procesa en el navegador.
 */
export function BarcodeScannerDialog({ open, onClose, onDetected }: { open: boolean; onClose: () => void; onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!open) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    setError(null);
    setStarting(true);

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este navegador no permite usar la cámara. Usa el lector de código de barras o escribe el código.');
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled || !videoRef.current) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } }, audio: false },
          videoRef.current,
          (result) => {
            if (result && !cancelled) {
              cancelled = true;
              controls.stop();
              onDetectedRef.current(result.getText());
            }
          },
        );
        stop = () => controls.stop();
        if (cancelled) stop();
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        setError(
          name === 'NotAllowedError'
            ? 'No se dio permiso para usar la cámara. Actívalo en la configuración del navegador.'
            : name === 'NotFoundError'
              ? 'No se encontró una cámara en este equipo.'
              : 'No se pudo iniciar la cámara. Usa el lector o escribe el código.',
        );
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Escanear con la cámara"
      description="Apunta al código de barras del empaque."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      {error ? (
        <Alert tone="warning">{error}</Alert>
      ) : (
        <div className="relative overflow-hidden rounded-lg bg-slate-900">
          <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
          {starting && <p className="absolute inset-x-0 bottom-2 text-center text-xs text-white/80">Iniciando cámara…</p>}
        </div>
      )}
    </Modal>
  );
}

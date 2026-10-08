import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

function renderModal(props: { busy?: boolean; onClose?: () => void }) {
  return (
    <Modal open title="Prueba" onClose={props.onClose ?? (() => {})} busy={props.busy}>
      <input aria-label="Primero" />
      <input aria-label="Segundo" />
    </Modal>
  );
}

describe('Modal', () => {
  it('enfoca el primer campo al abrir', () => {
    render(renderModal({}));
    expect(screen.getByLabelText('Primero')).toHaveFocus();
  });

  it('no mueve el foco cuando cambia el estado "guardando"', async () => {
    const { rerender } = render(renderModal({ busy: false }));
    await userEvent.click(screen.getByLabelText('Segundo'));
    rerender(renderModal({ busy: true }));
    rerender(renderModal({ busy: false }));
    expect(screen.getByLabelText('Segundo')).toHaveFocus();
  });

  it('Esc cierra, excepto mientras se guarda', async () => {
    const onClose = vi.fn();
    const { rerender } = render(renderModal({ busy: true, onClose }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    rerender(renderModal({ busy: false, onClose }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

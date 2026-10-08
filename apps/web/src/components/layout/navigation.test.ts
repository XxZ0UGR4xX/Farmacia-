import { hasPermission, SYSTEM_ROLES, type PermissionKey } from '@farmacia/shared';
import { describe, expect, it } from 'vitest';
import { allNavItems, filterNavigation, firstAllowedPath, isSection } from './navigation';

const canFor = (role: keyof typeof SYSTEM_ROLES) => (p: PermissionKey) =>
  hasPermission(role, SYSTEM_ROLES[role].permissions, p);

describe('navegación por rol', () => {
  it('el propietario ve todos los módulos', () => {
    expect(allNavItems(filterNavigation(canFor('OWNER')))).toHaveLength(allNavItems().length);
  });

  it('el cajero no ve inventario de compras, usuarios, auditoría ni configuración', () => {
    const labels = filterNavigation(canFor('CASHIER')).map((e) => e.label);
    expect(labels).toContain('Ventas');
    expect(labels).not.toContain('Compras');
    expect(labels).not.toContain('Usuarios');
    expect(labels).not.toContain('Auditoría');
    expect(labels).not.toContain('Configuración');
  });

  it('oculta secciones sin elementos permitidos', () => {
    for (const entry of filterNavigation(canFor('CASHIER'))) {
      if (isSection(entry)) expect(entry.items.length).toBeGreaterThan(0);
    }
  });

  it('el cajero (sin dashboard) entra directo al punto de venta', () => {
    expect(firstAllowedPath(canFor('CASHIER'))).toBe('/ventas/punto-de-venta');
    expect(firstAllowedPath(canFor('OWNER'))).toBe('/');
  });

  it('todas las rutas son únicas', () => {
    const paths = allNavItems().map((i) => i.to);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

import { Building2, FolderTree, Pill } from 'lucide-react';
import { Outlet } from 'react-router';
import { PageHeader } from '../../components/ui/Card';
import { TabNav } from '../../components/ui/TabNav';

const tabs = [
  { to: '/inventario/productos', label: 'Productos', icon: Pill, end: true },
  { to: '/inventario/productos/categorias', label: 'Categorías', icon: FolderTree },
  { to: '/inventario/productos/laboratorios', label: 'Laboratorios', icon: Building2 },
];

/** Lista y catálogos. El formulario de producto usa su propia página completa. */
export function ProductsLayout() {
  return (
    <div>
      <PageHeader title="Productos" description="Catálogo de medicamentos y productos de la farmacia." />
      <TabNav tabs={tabs} label="Secciones de productos" />
      <Outlet />
    </div>
  );
}

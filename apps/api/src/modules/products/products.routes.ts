import { Router, type Request, type Response } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { uuidParam } from '../../shared/params';
import { clientInfo, currentBranchId, requireAuth } from '../../shared/request-context';
import { deleteStoredImage, receiveImage, storeProductImage } from './product-images';
import { createProductSchema, listProductsSchema, updateProductSchema } from './products.schemas';
import * as service from './products.service';

const controller = {
  async list(req: Request, res: Response) {
    res.json(await service.listProducts(requireAuth(req), currentBranchId(req), listProductsSchema.parse(req.query)));
  },
  async get(req: Request, res: Response) {
    res.json({ product: await service.getProduct(requireAuth(req), currentBranchId(req), uuidParam(req)) });
  },
  async byBarcode(req: Request, res: Response) {
    const code = String(req.params.code ?? '');
    res.json({ product: await service.getProductByBarcode(requireAuth(req), currentBranchId(req), code) });
  },
  async create(req: Request, res: Response) {
    const dto = createProductSchema.parse(req.body);
    res.status(201).json({ product: await service.createProduct(requireAuth(req), currentBranchId(req), dto, clientInfo(req)) });
  },
  async update(req: Request, res: Response) {
    const dto = updateProductSchema.parse(req.body);
    res.json({
      product: await service.updateProduct(requireAuth(req), currentBranchId(req), uuidParam(req), dto, clientInfo(req)),
    });
  },
  async remove(req: Request, res: Response) {
    await service.deleteProduct(requireAuth(req), uuidParam(req), clientInfo(req));
    res.status(204).end();
  },
  async uploadImage(req: Request, res: Response) {
    const id = uuidParam(req);
    const auth = requireAuth(req);
    await service.getProduct(auth, currentBranchId(req), id); // 404 antes de escribir archivos
    const url = await storeProductImage(id, req.file!.buffer);
    const previous = await service.setProductImage(auth, id, url, clientInfo(req));
    await deleteStoredImage(previous);
    res.json({ imageUrl: url });
  },
  async removeImage(req: Request, res: Response) {
    const previous = await service.setProductImage(requireAuth(req), uuidParam(req), null, clientInfo(req));
    await deleteStoredImage(previous);
    res.status(204).end();
  },
};

export function productsRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', authorize('products.view'), controller.list);
  router.get('/barcode/:code', authorize('products.view'), controller.byBarcode);
  router.get('/:id', authorize('products.view'), controller.get);
  router.post('/', authorize('products.create'), controller.create);
  router.patch('/:id', authorize('products.edit'), controller.update);
  router.delete('/:id', authorize('products.delete'), controller.remove);
  router.post('/:id/image', authorize('products.edit'), receiveImage, controller.uploadImage);
  router.delete('/:id/image', authorize('products.edit'), controller.removeImage);

  return router;
}

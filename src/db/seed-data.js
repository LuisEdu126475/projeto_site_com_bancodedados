import { transaction } from './index.js';
import configMenu from '../config/menu.js';

/**
 * Cardápio inicial: vem de config/cardapio.config.js (já validado e
 * convertido para centavos em src/config/menu.js).
 */
export const DEFAULT_MENU = configMenu;

/**
 * Preenche o cardápio SOMENTE quando o banco ainda não tem nenhuma categoria.
 *
 * Depois que a cafeteria começa a usar o painel, o cardápio do banco é a única
 * fonte da verdade: categorias excluídas ou renomeadas no /admin não voltam
 * sozinhas quando o servidor reinicia.
 */
export function seedMenuIfEmpty(db, repos, menu = DEFAULT_MENU) {
  const existing = repos.menu.listCategories();
  if (existing.length > 0) {
    return { seeded: false, categories: existing.length, items: 0 };
  }

  let addedCategories = 0;
  let addedItems = 0;

  transaction(db, () => {
    for (const cat of menu) {
      const categoryId = repos.menu.createCategory({
        slug: cat.slug,
        name: cat.name,
        description: cat.description,
        position: cat.position,
        isActive: true,
      });
      addedCategories++;
      for (const item of cat.items) {
        repos.menu.createItem({
          categoryId,
          ...item,
          isAvailable: true,
        });
        addedItems++;
      }
    }
  });

  return {
    seeded: addedCategories > 0,
    categories: addedCategories,
    items: addedItems,
  };
}

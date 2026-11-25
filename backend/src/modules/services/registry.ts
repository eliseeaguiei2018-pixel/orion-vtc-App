import { notFound } from '../../core/errors.js';
import type { ServiceModule, ServiceType } from './types.js';

/**
 * Registre des services activés. Pattern Registry : le catalogue de services est ouvert
 * à l'extension. On peut activer/désactiver un service par zone (cf. service_catalog dans
 * docs/06) sans modifier le code appelant.
 */
export class ServiceRegistry {
  private readonly modules = new Map<ServiceType, ServiceModule>();

  register(module: ServiceModule): this {
    this.modules.set(module.type, module);
    return this;
  }

  get(type: ServiceType): ServiceModule {
    const m = this.modules.get(type);
    if (!m) throw notFound(`Service non disponible: ${type}`);
    return m;
  }

  has(type: ServiceType): boolean {
    return this.modules.has(type);
  }

  list(): ServiceType[] {
    return [...this.modules.keys()];
  }
}

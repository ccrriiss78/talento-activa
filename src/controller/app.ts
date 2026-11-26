import { Hono } from 'hono';
import { createLogoutRoutes, createMeRoutes, type LogoutDeps, type MeDeps } from './account';
import { createAuthRoutes, type AuthDeps } from './auth';
import { createCompanyRoutes, type CompanyRoutesDeps } from './companies';
import { createEditionRoutes, type EditionRoutesDeps } from './editions';
import { manejarErrores } from './errores';
import { createProjectRoutes, type ProjectRoutesDeps } from './projects';
import { createRegisterRoutes, type RegisterDeps } from './register';
import { createStudentConsentRoutes, type StudentConsentRoutesDeps } from './student-consent';
import { createStudentForgetRoutes, type StudentForgetRoutesDeps } from './student-forget';
import { createStudentSelfRoutes, type StudentSelfRoutesDeps } from './student-self';
import { createStudentStatusRoutes, type StudentStatusRoutesDeps } from './student-status';
import { createStudentRoutes, type StudentRoutesDeps } from './students';
import { createCatalogRoutes, createTaxonomyRoutes, type CatalogRoutesDeps, type TaxonomyRoutesDeps } from './taxonomy';
import { createVerifyEmailRoutes, type VerifyEmailDeps } from './verify-email';

export type AppDeps = AuthDeps &
  LogoutDeps &
  MeDeps &
  RegisterDeps &
  VerifyEmailDeps &
  EditionRoutesDeps &
  CompanyRoutesDeps &
  StudentRoutesDeps &
  StudentSelfRoutesDeps &
  StudentStatusRoutesDeps &
  StudentConsentRoutesDeps &
  StudentForgetRoutesDeps &
  ProjectRoutesDeps &
  CatalogRoutesDeps & {
    studentSkills: TaxonomyRoutesDeps['model'];
    studentLanguages: TaxonomyRoutesDeps['model'];
  };

/**
 * Punto único de composición: monta todos los routers bajo `/api` en sus prefijos reales.
 * Los routers que comparten prefijo (`/api/students`) usan middleware por ruta.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.onError(manejarErrores);

  const api = new Hono();
  api.route('/auth', createAuthRoutes(deps));
  api.route('/auth', createLogoutRoutes(deps));
  api.route('/auth', createRegisterRoutes(deps));
  api.route('/auth', createVerifyEmailRoutes(deps));
  api.route('/', createMeRoutes(deps));
  api.route('/editions', createEditionRoutes(deps));
  api.route('/companies', createCompanyRoutes(deps));
  api.route('/catalog', createCatalogRoutes(deps));
  api.route('/students/me/projects', createProjectRoutes(deps));
  api.route('/students/me/skills', createTaxonomyRoutes({ ...deps, model: deps.studentSkills }));
  api.route('/students/me/languages', createTaxonomyRoutes({ ...deps, model: deps.studentLanguages }));
  api.route('/students/me', createStudentSelfRoutes(deps));
  api.route('/students', createStudentRoutes(deps));
  api.route('/students', createStudentConsentRoutes(deps));
  api.route('/students', createStudentStatusRoutes(deps));
  api.route('/students', createStudentForgetRoutes(deps));

  app.route('/api', api);
  return app;
}

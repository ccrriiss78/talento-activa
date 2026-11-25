export type Rol = 'ADMIN' | 'SOCIO' | 'ALUMNO';
export interface Actor {
  id: string;
  rol: Rol;
}

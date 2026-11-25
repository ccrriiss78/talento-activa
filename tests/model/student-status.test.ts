import { describe, it, expect, vi } from 'vitest';
import { createStudentStatusModel } from '../../src/model/student-status';
import { FichaNoEncontradaError } from '../../src/model/student-profile';
import { DatosNoValidosError } from '../../src/model/password';
import type { Db } from '../../src/model/db';

const ALUMNO = { id: 'u1', rol: 'ALUMNO' as const };
const ADMIN = { id: 'a1', rol: 'ADMIN' as const };
const SOCIO = { id: 'c1', rol: 'SOCIO' as const };
const ST = { id: 's1', user_id: 'u1', edition_id: 'e1', nombre: 'Ana', estado: 'inactivo' };

function setup(rows: { select?: unknown[]; update?: unknown[] } = {}) {
  const select = rows.select ?? [ST];
  const query = vi.fn(async (sql: string, _p?: unknown[]) =>
    /^\s*select/i.test(sql) ? select : (rows.update ?? [{ ...ST, estado: 'activo' }]),
  );
  const tx = { query };
  const db = { query, transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as Db;
  const record = vi.fn(async () => {});
  return { model: createStudentStatusModel(db, { record }), query, record, tx };
}

describe('StudentStatus.setEstado', () => {
  it('el alumno cambia SU estado (por user_id) y se audita antes/después', async () => {
    const { model, query, record, tx } = setup();
    const r = await model.setEstado(ALUMNO, 'activo');
    expect(r.estado).toBe('activo');
    expect(query.mock.calls[0]![1]).toEqual(['u1']);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: ALUMNO, tabla: 'Student', idRegistro: 's1', operacion: 'UPDATE',
        datosAnteriores: ST, datosNuevos: expect.objectContaining({ estado: 'activo' }) }),
      tx,
    );
  });

  it('el admin cambia el estado de cualquier alumno por id de Student', async () => {
    const { model, query } = setup();
    await model.setEstado(ADMIN, 'inactivo', 's1');
    expect(query.mock.calls[0]![0]).toMatch(/where id = \$1/i);
    expect(query.mock.calls[0]![1]).toEqual(['s1']);
  });

  it('el alumno ignora un studentId ajeno: solo toca el suyo', async () => {
    const { model, query } = setup();
    await model.setEstado(ALUMNO, 'activo', 'otro');
    expect(query.mock.calls[0]![1]).toEqual(['u1']);
  });

  it('el admin sin studentId, o un SOCIO, no pueden => no encontrada sin tocar BD', async () => {
    const a = setup();
    await expect(a.model.setEstado(ADMIN, 'activo')).rejects.toBeInstanceOf(FichaNoEncontradaError);
    const s = setup();
    await expect(s.model.setEstado(SOCIO, 'activo', 's1')).rejects.toBeInstanceOf(FichaNoEncontradaError);
    expect(a.query).not.toHaveBeenCalled();
    expect(s.query).not.toHaveBeenCalled();
  });

  it.each(['borrado', '', 5, null])('estado %j no válido', async (e) => {
    const { model, query } = setup();
    await expect(model.setEstado(ALUMNO, e as never)).rejects.toBeInstanceOf(DatosNoValidosError);
    expect(query).not.toHaveBeenCalled();
  });

  it('ficha inexistente => FichaNoEncontradaError y no audita', async () => {
    const { model, record } = setup({ select: [] });
    await expect(model.setEstado(ALUMNO, 'activo')).rejects.toBeInstanceOf(FichaNoEncontradaError);
    expect(record).not.toHaveBeenCalled();
  });
});

describe('StudentStatus.getForCompany (enforcement de visibilidad)', () => {
  const FICHA = { ...ST, estado: 'activo', bio: 'Hola', linkedin: 'https://l.in/x', github: 'https://g.com/x',
    cv_url: null, foto_url: null, ubicacion: 'Valencia', disponibilidad_traslado: true, modalidad: 'remoto',
    estado_laboral: 'buscando', privacy: { bio: true, linkedin: false } };

  it('consulta solo alumnos activos (el filtro va en la consulta)', async () => {
    const { model, query } = setup({ select: [FICHA] });
    await model.getForCompany(SOCIO, 's1');
    expect(query.mock.calls[0]![0]).toMatch(/estado = 'activo'/i);
    expect(query.mock.calls[0]![1]).toEqual(['s1']);
  });

  it('un inactivo (sin filas) es como si no existiera', async () => {
    const { model } = setup({ select: [] });
    await expect(model.getForCompany(SOCIO, 's1')).rejects.toBeInstanceOf(FichaNoEncontradaError);
  });

  it('solo SOCIO consulta; ALUMNO y ADMIN no, sin tocar BD', async () => {
    for (const a of [ALUMNO, ADMIN]) {
      const { model, query } = setup({ select: [FICHA] });
      await expect(model.getForCompany(a, 's1')).rejects.toBeInstanceOf(FichaNoEncontradaError);
      expect(query).not.toHaveBeenCalled();
    }
  });

  it('privacidad por defecto: solo se muestran los campos con privacy[campo] === true; nunca privacy/user_id', async () => {
    const { model } = setup({ select: [FICHA] });
    const r = await model.getForCompany(SOCIO, 's1');
    expect(r).toEqual({ id: 's1', edition_id: 'e1', nombre: 'Ana', bio: 'Hola' });
  });
});

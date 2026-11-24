import { describe, it, expect } from 'vitest';
import { APP_NAME } from '../src/model/app';

describe('andamiaje', () => {
  it('expone el nombre de la aplicación', () => {
    expect(APP_NAME).toBe('talento-activa');
  });
});

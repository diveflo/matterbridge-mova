import initializePlugin, { MovaPlatform } from '../src/module.js';

describe('Matterbridge MOVA module', () => {
  it('exports the Matterbridge plugin entry point', () => {
    expect(initializePlugin).toEqual(expect.any(Function));
  });

  it('exports the MOVA platform class', () => {
    expect(MovaPlatform).toEqual(expect.any(Function));
  });
});

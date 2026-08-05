import { beforeEach, describe, expect, it } from 'vitest';
import {
  addBarToList,
  createList,
  deleteList,
  foldIntoList,
  loadLists,
  pruneBarsFromList,
  removeBarFromList,
} from '@/lib/lists';

const KEY = 'next-bar:lists:v1';

describe('lists lib', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts empty and round-trips a created list', () => {
    expect(loadLists()).toEqual([]);
    const created = createList('Top 10 date bars');
    expect(created).not.toBeNull();
    const lists = loadLists();
    expect(lists).toHaveLength(1);
    expect(lists[0].name).toBe('Top 10 date bars');
    expect(lists[0].barIds).toEqual([]);
    expect(lists[0].id).toBe(created?.id);
  });

  it('trims names and rejects empty ones', () => {
    expect(createList('   ')).toBeNull();
    const created = createList('  Rooftops  ');
    expect(created?.name).toBe('Rooftops');
    expect(loadLists()).toHaveLength(1);
  });

  it('adds bars without duplicates and bumps updatedAt', () => {
    const list = createList('Rooftops');
    if (!list) throw new Error('createList failed');
    addBarToList(list.id, 'bar-a');
    addBarToList(list.id, 'bar-b');
    addBarToList(list.id, 'bar-a');
    const [stored] = loadLists();
    expect(stored.barIds).toEqual(['bar-a', 'bar-b']);
    expect(stored.updatedAt >= stored.createdAt).toBe(true);
  });

  it('removes a bar and ignores unknown list ids', () => {
    const list = createList('Dives');
    if (!list) throw new Error('createList failed');
    addBarToList(list.id, 'bar-a');
    addBarToList(list.id, 'bar-b');
    removeBarFromList(list.id, 'bar-a');
    expect(loadLists()[0].barIds).toEqual(['bar-b']);
    // No-ops, no throws:
    addBarToList('nope', 'bar-z');
    removeBarFromList('nope', 'bar-z');
    expect(loadLists()).toHaveLength(1);
  });

  it('deletes a list', () => {
    const keep = createList('Keep');
    const drop = createList('Drop');
    if (!keep || !drop) throw new Error('createList failed');
    deleteList(drop.id);
    const lists = loadLists();
    expect(lists).toHaveLength(1);
    expect(lists[0].id).toBe(keep.id);
  });

  it('returns [] on corrupted storage instead of throwing', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(loadLists()).toEqual([]);
    window.localStorage.setItem(KEY, JSON.stringify([{ nope: true }]));
    expect(loadLists()).toEqual([]);
  });

  it('generates distinct ids for same-named lists', () => {
    const a = createList('Same');
    const b = createList('Same');
    expect(a?.id).not.toBe(b?.id);
    expect(loadLists()).toHaveLength(2);
  });

  describe('foldIntoList (g-ac3a291c reserved-list fold)', () => {
    it('creates the list with the given fixed id when absent', () => {
      foldIntoList('want-to-go', 'Want to go', ['a', 'b']);
      const list = loadLists().find((l) => l.id === 'want-to-go');
      expect(list).toBeDefined();
      expect(list!.name).toBe('Want to go');
      expect(list!.barIds).toEqual(['a', 'b']);
    });

    it('appends only missing bars to an existing list, preserving order, in one write', () => {
      foldIntoList('want-to-go', 'Want to go', ['a']);
      foldIntoList('want-to-go', 'Want to go', ['b', 'a', 'c']);
      const list = loadLists().find((l) => l.id === 'want-to-go');
      expect(list!.barIds).toEqual(['a', 'b', 'c']);
      expect(loadLists()).toHaveLength(1);
    });

    it('empty barIds still ensures the list exists', () => {
      foldIntoList('want-to-go', 'Want to go', []);
      expect(loadLists().find((l) => l.id === 'want-to-go')).toBeDefined();
    });
  });

  describe('pruneBarsFromList', () => {
    it('drops every matching bar in one pass and no-ops otherwise', () => {
      foldIntoList('want-to-go', 'Want to go', ['a', 'b', 'c']);
      pruneBarsFromList('want-to-go', new Set(['a', 'c', 'unrelated']));
      expect(
        loadLists().find((l) => l.id === 'want-to-go')!.barIds,
      ).toEqual(['b']);
      const before = window.localStorage.getItem(KEY);
      pruneBarsFromList('want-to-go', new Set(['nope']));
      expect(window.localStorage.getItem(KEY)).toBe(before);
    });
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyTask } from '../src/data/syntheticData.ts';
import { calculateRating } from '../src/services/ratingService.ts';

type RatedField = 'consultationFormat' | 'availableData' | 'successCriteria';

function rating(field: RatedField, value: string, confirmed = true) {
  return calculateRating({
    ...createEmptyTask(),
    [field]: value,
    confirmedFields: confirmed ? [field] : [],
  });
}

test('a deferred detail does not erase an already specified consultation format', () => {
  const value = 'Подробности обсудим позже. Сейчас доступны еженедельные видеозвонки с куратором.';
  assert.equal(rating('consultationFormat', value).businessCommunication, 5);
  assert.equal(rating('consultationFormat', 'Подробности обсудим позже.').total, 0);
  const unconfirmed = rating('consultationFormat', value, false);
  assert.equal(unconfirmed.total, 0);
  assert.equal(unconfirmed.potentialTotal, 5);
});

test('explicitly unavailable formats do not earn data points while a usable alternative does', () => {
  assert.equal(rating('availableData', 'Данных CSV пока нет, JSON тоже не предоставим.').data, 0);
  assert.equal(rating('availableData', 'Данных CSV пока нет. Доступна таблица продаж за прошлый год.').data, 20);
  assert.equal(rating('availableData', 'Нет данных о клиентах, но есть обезличенные продажи в CSV за год.').data, 20);
  assert.equal(rating('availableData', 'В CSV нет персональных данных, доступны продажи за прошлый год.').data, 20);
});

test('rejected metrics earn no credit and do not hide a separate accepted metric', () => {
  assert.equal(rating('successCriteria', 'Точность 95% не является критерием, критерии обсудим позже.').successCriteria, 0);
  assert.equal(rating('successCriteria', 'Точность 95% не является критерием. F1 ≥ 0.9.').successCriteria, 15);
  assert.equal(rating('successCriteria', 'Точность не менее 95%.').successCriteria, 15);
  assert.equal(rating('successCriteria', 'F1: уточним потом.').successCriteria, 0);
});

test('future collection does not discount already available data', () => {
  assert.equal(rating('availableData', 'Доступны CSV за год. Планируем собрать также новые логи.').data, 20);
  assert.equal(rating('availableData', 'Планируем собрать также новые логи. Доступны CSV за год.').data, 20);
  assert.equal(rating('availableData', 'Планируем собрать логи транзакций за следующий месяц.').data, 10);
});

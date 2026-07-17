/**
 * Money utilities for handling currency in paise to avoid floating-point errors.
 */

/**
 * Validates if a number is a safe integer paise value.
 * Reject: Negative values, non-integers, invalid numbers.
 * @param {any} val
 * @returns {boolean}
 */
function isValidMonetaryValue(val) {
  if (typeof val !== 'number') return false;
  if (!Number.isInteger(val)) return false;
  if (val < 0) return false;
  if (val > Number.MAX_SAFE_INTEGER) return false;
  return true;
}

/**
 * Converts a Rupee amount (string or number) to Paise.
 * Rejects negative values, invalid formats, and unsupported decimal precision (> 2 decimal places).
 * @param {string|number} rupees
 * @returns {number}
 * @throws {Error}
 */
function rupeesToPaise(rupees) {
  if (rupees === null || rupees === undefined) {
    throw new Error('Rupees amount must be provided');
  }

  let str = String(rupees).trim();

  // Validate number format (e.g. 10, 10.5, 10.55, but not negative, empty, or non-numeric)
  const regex = /^\d+(\.\d+)?$/;
  if (!regex.test(str)) {
    throw new Error('Invalid monetary value: must be a positive number');
  }

  const parts = str.split('.');
  const whole = parts[0];
  const decimal = parts[1] || '';

  if (decimal.length > 2) {
    throw new Error('Unsupported decimal precision: maximum of 2 decimal places supported');
  }

  // Pad decimal parts to ensure it has 2 digits (e.g. .5 becomes .50, empty becomes .00)
  const paddedDecimal = decimal.padEnd(2, '0');

  const paise = parseInt(whole + paddedDecimal, 10);

  if (!isValidMonetaryValue(paise)) {
    throw new Error('Invalid monetary value: conversion resulted in unsafe integer');
  }

  return paise;
}

/**
 * Converts a Paise amount (integer) to Rupee string (with 2 decimal places).
 * @param {number} paise
 * @returns {string}
 */
function paiseToRupees(paise) {
  if (!Number.isInteger(paise)) {
    throw new Error('Paise value must be an integer');
  }

  const isNegative = paise < 0;
  const absolutePaise = Math.abs(paise);

  const whole = Math.floor(absolutePaise / 100);
  const decimal = absolutePaise % 100;
  const decimalStr = String(decimal).padStart(2, '0');

  return `${isNegative ? '-' : ''}${whole}.${decimalStr}`;
}

/**
 * Calculates 10% advance payout amount with half-up rounding.
 * E.g., 4015 paise -> 10% is 401.5 -> rounded to 402 paise.
 * @param {number} earningPaise
 * @returns {number}
 */
function calculateAdvanceAmount(earningPaise) {
  if (!isValidMonetaryValue(earningPaise)) {
    throw new Error('Invalid earning value for advance calculation');
  }

  // Calculate 10% and round half-up to nearest integer (paise)
  return Math.round(earningPaise * 0.1);
}

module.exports = {
  isValidMonetaryValue,
  rupeesToPaise,
  paiseToRupees,
  calculateAdvanceAmount,
};

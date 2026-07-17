const {
  rupeesToPaise,
  paiseToRupees,
  calculateAdvanceAmount,
  isValidMonetaryValue,
} = require('../../src/utils/money');

describe('Money Utility Tests', () => {
  describe('isValidMonetaryValue', () => {
    test('validates correct integer paise values', () => {
      expect(isValidMonetaryValue(0)).toBe(true);
      expect(isValidMonetaryValue(100)).toBe(true);
      expect(isValidMonetaryValue(1000000)).toBe(true);
    });

    test('rejects negative values', () => {
      expect(isValidMonetaryValue(-1)).toBe(false);
      expect(isValidMonetaryValue(-100)).toBe(false);
    });

    test('rejects non-integer values', () => {
      expect(isValidMonetaryValue(10.5)).toBe(false);
      expect(isValidMonetaryValue('100')).toBe(false);
      expect(isValidMonetaryValue(null)).toBe(false);
      expect(isValidMonetaryValue(undefined)).toBe(false);
      expect(isValidMonetaryValue({})).toBe(false);
    });
  });

  describe('rupeesToPaise', () => {
    test('converts integer rupee strings/numbers to paise', () => {
      expect(rupeesToPaise('40')).toBe(4000);
      expect(rupeesToPaise(40)).toBe(4000);
      expect(rupeesToPaise('0')).toBe(0);
    });

    test('converts decimal rupee strings/numbers to paise', () => {
      expect(rupeesToPaise('40.50')).toBe(4050);
      expect(rupeesToPaise('40.5')).toBe(4050);
      expect(rupeesToPaise(40.5)).toBe(4050);
      expect(rupeesToPaise('40.05')).toBe(4005);
    });

    test('rejects values with more than 2 decimal places', () => {
      expect(() => rupeesToPaise('40.123')).toThrow('Unsupported decimal precision');
      expect(() => rupeesToPaise(40.123)).toThrow('Unsupported decimal precision');
    });

    test('rejects negative values', () => {
      expect(() => rupeesToPaise('-40')).toThrow('Invalid monetary value');
      expect(() => rupeesToPaise(-40)).toThrow('Invalid monetary value');
    });

    test('rejects non-numeric values', () => {
      expect(() => rupeesToPaise('abc')).toThrow('Invalid monetary value');
      expect(() => rupeesToPaise('')).toThrow('Invalid monetary value');
    });
  });

  describe('paiseToRupees', () => {
    test('converts positive paise to rupee string', () => {
      expect(paiseToRupees(4000)).toBe('40.00');
      expect(paiseToRupees(4050)).toBe('40.50');
      expect(paiseToRupees(4005)).toBe('40.05');
      expect(paiseToRupees(0)).toBe('0.00');
    });

    test('converts negative paise to rupee string', () => {
      expect(paiseToRupees(-4000)).toBe('-40.00');
      expect(paiseToRupees(-4050)).toBe('-40.50');
      expect(paiseToRupees(-4005)).toBe('-40.05');
    });

    test('rejects non-integer values', () => {
      expect(() => paiseToRupees(10.5)).toThrow('Paise value must be an integer');
      expect(() => paiseToRupees('100')).toThrow('Paise value must be an integer');
    });
  });

  describe('calculateAdvanceAmount', () => {
    test('calculates 10% advance with standard rounding', () => {
      expect(calculateAdvanceAmount(4000)).toBe(400); // 10% of 4000 is 400
      expect(calculateAdvanceAmount(4015)).toBe(402); // 10% of 4015 is 401.5 -> rounds to 402
      expect(calculateAdvanceAmount(4014)).toBe(401); // 10% of 4014 is 401.4 -> rounds to 401
      expect(calculateAdvanceAmount(4025)).toBe(403); // 10% of 4025 is 402.5 -> rounds to 403
      expect(calculateAdvanceAmount(0)).toBe(0);
    });

    test('rejects invalid inputs', () => {
      expect(() => calculateAdvanceAmount(-100)).toThrow('Invalid earning value');
      expect(() => calculateAdvanceAmount(10.5)).toThrow('Invalid earning value');
    });
  });
});

const icons = require('@sanity/icons');
console.log(Object.keys(icons).filter(k => k.includes('Cart') || k.includes('Basket') || k.includes('Bag') || k.includes('Shop') || k.includes('Bill')));

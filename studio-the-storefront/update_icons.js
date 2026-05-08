import fs from 'fs';
import path from 'path';

const schemas = [
  { file: 'product.ts', icon: 'RobotIcon', emoji: '🤖' },
  { file: 'category.ts', icon: 'TagIcon', emoji: '🏷️' },
  { file: 'order.ts', icon: 'BasketIcon', emoji: '🛒' },
  { file: 'agentConfig.ts', icon: 'CogIcon', emoji: '⚙️' },
];

const schemaDir = '/home/Veldrine/storefront/studio-the-storefront/schemaTypes';

schemas.forEach(s => {
  const filePath = path.join(schemaDir, s.file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Add import
    if (!content.includes('@sanity/icons')) {
      content = `import {${s.icon}} from '@sanity/icons'\n` + content;
    }
    
    // Add icon property if not present
    if (!content.includes('icon:')) {
      content = content.replace("type: 'document',", `type: 'document', icon: ${s.icon},`);
    } else {
      // Update existing icon (like the emoji one I just added)
      content = content.replace(/icon: .*,/, `icon: ${s.icon},`);
    }
    
    fs.writeFileSync(filePath, content);
    console.log(`Updated ${s.file}`);
  }
});

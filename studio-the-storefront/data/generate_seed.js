const fs = require('fs');
const path = require('path');

const categories = [
  {"_id": "cat-gpu", "_type": "category", "name": "Graphics Processing Units", "slug": {"_type": "slug", "current": "gpu"}, "description": "High-performance compute units for LLM training and real-time rendering.", "synonyms": ["video card", "graphics card", "compute node", "accelerator"]},
  {"_id": "cat-asic", "_type": "category", "name": "Application-Specific Integrated Circuits", "slug": {"_type": "slug", "current": "asic"}, "description": "Hardware optimized for specific algorithms like SHA-256 or Ethash.", "synonyms": ["miner", "rig", "mining hardware", "fixed-function compute"]},
  {"_id": "cat-cpu", "_type": "category", "name": "Microprocessors", "slug": {"_type": "slug", "current": "microprocessors"}, "description": "High-performance CPUs for desktop and server compute.", "synonyms": ["cpu", "processor", "chip", "silicon"]},
  {"_id": "cat-mcu", "_type": "category", "name": "Microcontrollers", "slug": {"_type": "slug", "current": "microcontrollers"}, "description": "Low-power embedded controllers for IoT and robotics.", "synonyms": ["mcu", "embedded", "iot", "controller"]},
  {"_id": "cat-networking", "_type": "category", "name": "Networking", "slug": {"_type": "slug", "current": "networking"}, "description": "Enterprise and consumer networking gear.", "synonyms": ["router", "switch", "access point", "network"]},
  {"_id": "cat-laptops", "_type": "category", "name": "Laptops", "slug": {"_type": "slug", "current": "laptops"}, "description": "Portable computing devices.", "synonyms": ["notebook", "laptop", "workstation", "portable"]},
  {"_id": "cat-peripherals", "_type": "category", "name": "Peripherals", "slug": {"_type": "slug", "current": "peripherals"}, "description": "Input and output devices for computing systems.", "synonyms": ["keyboard", "mouse", "monitor", "peripheral"]}
];

const brands = {
  gpu: ['NVIDIA', 'AMD', 'Intel', 'Matrox', 'EVGA', 'ASUS', 'MSI', 'Gigabyte', 'Zotac', 'Sapphire'],
  asic: ['Bitmain', 'MicroBT', 'Canaan', 'Innosilicon', 'Goldshell', 'IceRiver', 'Jasminer', 'Ibelink', 'StrongU', 'Ebang'],
  cpu: ['Intel', 'AMD', 'Apple', 'Qualcomm', 'MediaTek', 'IBM', 'Ampere', 'Marvell', 'NXP', 'Rockchip'],
  mcu: ['Espressif', 'STMicroelectronics', 'Microchip', 'NXP', 'Texas Instruments', 'Infineon', 'Renesas', 'Silicon Labs', 'Nordic Semi', 'Raspberry Pi'],
  networking: ['Ubiquiti', 'Cisco', 'Netgear', 'TP-Link', 'Aruba', 'MikroTik', 'Juniper', 'Fortinet', 'Palo Alto', 'Sophos'],
  laptops: ['Framework', 'Apple', 'Dell', 'Lenovo', 'HP', 'ASUS', 'Acer', 'Razer', 'MSI', 'System76'],
  peripherals: ['Keychron', 'Logitech', 'Razer', 'Corsair', 'SteelSeries', 'HyperX', 'Wooting', 'Glorious', 'Ducky', 'NuPhy']
};

const models = {
  gpu: ['RTX 5090', 'RX 8900 XTX', 'Arc Battlemage', 'A100 Tensor Core', 'H200 NVL', 'RTX 4080 Super', 'RX 7800 XT', 'RTX 4060 Ti', 'RX 7600', 'A6000 Ada'],
  asic: ['Antminer S21 Pro', 'WhatsMiner M60S', 'Avalon A1466', 'KS3', 'KA3', 'L7', 'K7', 'D9', 'E9 Pro', 'Z15 Pro'],
  cpu: ['Core i9-15900K', 'Ryzen 9 9950X', 'M3 Max', 'Snapdragon X Elite', 'EPYC 9654', 'Xeon Platinum 8490H', 'Core i7-14700K', 'Ryzen 7 7800X3D', 'Core i5-14600K', 'Ryzen 5 7600X'],
  mcu: ['ESP32-C6', 'STM32H7', 'PIC32MZ', 'RP2040', 'nRF52840', 'ATmega328P', 'SAMD51', 'Teensy 4.1', 'ESP32-S2', 'STM32F4'],
  networking: ['Dream Machine SE', 'Catalyst 9300', 'Orbi WiFi 7', 'Omada SDN Controller', 'Instant On AP22', 'CRS305', 'EX2300', 'FortiGate 40F', 'PA-440', 'XG 115'],
  laptops: ['Laptop 13', 'MacBook Pro 16', 'XPS 15', 'ThinkPad X1 Carbon', 'Spectre x360', 'ROG Zephyrus G14', 'Swift Edge 16', 'Blade 15', 'Stealth 16', 'Lemur Pro'],
  peripherals: ['Q2 Pro', 'MX Master 3S', 'DeathAdder V3', 'K70 RGB', 'Apex Pro', 'Cloud III', '60HE', 'GMMK Pro', 'One 3 Mini', 'Halo65']
};

const generateSku = (brand, model) => {
  return `${brand.substring(0,3).toUpperCase()}-${model.replace(/[^a-zA-Z0-9]/g, '').substring(0,6).toUpperCase()}-${Math.floor(Math.random()*1000)}`;
};

const generateSlug = (brand, model) => {
  return `${brand.toLowerCase().replace(/\\s+/g, '-')}-${model.toLowerCase().replace(/\\s+/g, '-')}-${Math.floor(Math.random()*1000)}`;
};

const products = [];
let idCounter = 1;

Object.keys(brands).forEach(cat => {
  const catBrands = brands[cat];
  const catModels = models[cat];
  
  // Create 15 products per category
  for (let i = 0; i < 15; i++) {
    const brand = catBrands[i % catBrands.length];
    const model = catModels[i % catModels.length];
    const name = `${brand} ${model}`;
    const price = Number((Math.random() * (0.5 - 0.01) + 0.01).toFixed(3));
    
    products.push({
      "_id": `prod-gen-${idCounter++}`,
      "_type": "product",
      "name": name,
      "sku": generateSku(brand, model),
      "slug": {"_type": "slug", "current": generateSlug(brand, model)},
      "status": Math.random() > 0.1 ? "active" : "preorder",
      "stock": Math.floor(Math.random() * 200),
      "price": price,
      "machineDescription": `High-quality ${name} designed for optimal performance in ${cat} workloads. Reliable, efficient, and well-supported.`,
      "hardwareSpecs": [
        {"property": "Brand", "value": brand},
        {"property": "Series", "value": model.split(' ')[0]}
      ],
      "negotiationRules": {
        "isNegotiable": Math.random() > 0.3,
        "floorPrice": Number((price * 0.8).toFixed(3)),
        "maxDiscountPercentage": 20
      },
      "agentSalesInstructions": `Highlight the reliability of ${brand} and the performance of ${model}. Offer volume discounts if customer asks.`,
      "categories": [{"_type": "reference", "_ref": `cat-${cat}`}],
      "embeddings": [Math.random()*2-1, Math.random()*2-1, Math.random()*2-1, Math.random()*2-1, Math.random()*2-1]
    });
  }
});

// Original specific products
const originalProducts = [
  {"_id": "prod-h100", "_type": "product", "name": "NVIDIA H100 NVL", "sku": "NV-H100-NVL", "slug": {"_type": "slug", "current": "nvidia-h100-nvl"}, "status": "active", "stock": 12, "price": 0.1, "machineDescription": "H100 NVL is a dual-GPU PCIe card designed for LLM inference. Optimized for transformer models with 188GB HBM3 memory. FP8 Tensor Core performance is 8x faster than A100.", "hardwareSpecs": [{"property": "Memory", "value": "188GB HBM3"}, {"property": "Bandwidth", "value": "7.8 TB/s"}, {"property": "TDP", "value": "700W"}], "negotiationRules": {"isNegotiable": true, "floorPrice": 0.05, "maxDiscountPercentage": 15}, "agentSalesInstructions": "Emphasize the NVLink bridge capability and massive VRAM for serving Llama-3-70B. Highlight immediate stock availability compared to GH200 lead times.", "categories": [{"_type": "reference", "_ref": "cat-gpu"}], "embeddings": [0.12, -0.45, 0.88, 0.01, -0.23]},
  {"_id": "prod-s21", "_type": "product", "name": "Bitmain Antminer S21", "sku": "BM-S21-200T", "slug": {"_type": "slug", "current": "bitmain-antminer-s21"}, "status": "active", "stock": 50, "price": 0.1, "machineDescription": "The Antminer S21 is the most efficient SHA-256 miner. 200 TH/s hashrate with an efficiency of 17.5 J/T. Built for high-density mining farms.", "hardwareSpecs": [{"property": "Hashrate", "value": "200 TH/s"}, {"property": "Efficiency", "value": "17.5 J/TH"}, {"property": "Network", "value": "RJ45 Ethernet"}], "negotiationRules": {"isNegotiable": false}, "agentSalesInstructions": "Focus on ROI metrics for institutional miners. Note that power supplies are included in this batch.", "categories": [{"_type": "reference", "_ref": "cat-asic"}], "embeddings": [-0.88, 0.12, -0.34, 0.99, 0.55]},
  {"_id": "prod-i9-14900k", "_type": "product", "name": "Intel Core i9-14900K", "sku": "INT-I9-14900K", "slug": {"_type": "slug", "current": "intel-core-i9-14900k"}, "status": "active", "stock": 45, "price": 0.1, "machineDescription": "The Intel Core i9-14900K is a high-end desktop processor with 24 cores (8 P-cores and 16 E-cores). Boost clock up to 6.0 GHz. Support for DDR5 and PCIe 5.0.", "hardwareSpecs": [{"property": "Cores", "value": "24 (8P + 16E)"}, {"property": "Threads", "value": "32"}, {"property": "Max Turbo Frequency", "value": "6.0 GHz"}, {"property": "TDP", "value": "125W (253W Max)"}], "negotiationRules": {"isNegotiable": true, "floorPrice": 0.05, "maxDiscountPercentage": 8}, "agentSalesInstructions": "Emphasize the 6GHz boost clock for gaming and single-threaded tasks. Note that it requires a high-end Z790 motherboard and substantial cooling.", "categories": [{"_type": "reference", "_ref": "cat-cpu"}], "embeddings": [0.5, -0.2, 0.9, -0.1, 0.3]},
  {"_id": "prod-esp32-s3", "_type": "product", "name": "ESP32-S3-DevKitC-1", "sku": "EXP-ESP32-S3", "slug": {"_type": "slug", "current": "esp32-s3-devkitc-1"}, "status": "active", "stock": 150, "price": 0.1, "machineDescription": "ESP32-S3 is a dual-core XTensa LX7 MCU with integrated Wi-Fi and Bluetooth 5 (LE). Includes AI acceleration instructions and 45 programmable GPIOs.", "hardwareSpecs": [{"property": "Processor", "value": "Dual-core 32-bit LX7"}, {"property": "Connectivity", "value": "Wi-Fi + BT 5.0 LE"}, {"property": "SRAM", "value": "512 KB"}, {"property": "Flash", "value": "8 MB"}], "negotiationRules": {"isNegotiable": false}, "agentSalesInstructions": "Focus on the AI acceleration for edge voice and vision tasks. Mention its popularity in the maker community and robust documentation.", "categories": [{"_type": "reference", "_ref": "cat-mcu"}], "embeddings": [-0.3, 0.8, -0.1, 0.4, -0.6]},
  {"_id": "prod-udm-pro", "_type": "product", "name": "Ubiquiti UniFi Dream Machine Pro", "sku": "UB-UDM-PRO", "slug": {"_type": "slug", "current": "ubiquiti-unifi-dream-machine-pro"}, "status": "active", "stock": 25, "price": 0.1, "machineDescription": "The UDM Pro is an enterprise-grade UniFi OS Console and security gateway. Features an 8-port switch, 10G SFP+ ports, and integrated 3.5\" HDD bay for UniFi Protect.", "hardwareSpecs": [{"property": "Throughput", "value": "3.5 Gbps (IPS/IDS)"}, {"property": "Switch Ports", "value": "8x 1GbE RJ45"}, {"property": "WAN Ports", "value": "1x 1GbE RJ45, 1x 10G SFP+"}, {"property": "Rackmount", "value": "1U"}], "negotiationRules": {"isNegotiable": true, "floorPrice": 0.05, "maxDiscountPercentage": 5}, "agentSalesInstructions": "Highlight the all-in-one nature: router, switch, and NVR. Emphasize the UniFi ecosystem integration and no-subscription model.", "categories": [{"_type": "reference", "_ref": "cat-networking"}], "embeddings": [0.1, 0.1, 0.1, 0.9, -0.2]},
  {"_id": "prod-rtx-4090", "_type": "product", "name": "NVIDIA GeForce RTX 4090", "sku": "NV-RTX-4090-FE", "slug": {"_type": "slug", "current": "nvidia-geforce-rtx-4090"}, "status": "active", "stock": 8, "price": 0.1, "machineDescription": "The GeForce RTX 4090 is the ultimate GeForce GPU. It brings an enormous leap in performance, efficiency, and AI-powered graphics with DLSS 3. 24GB G6X memory.", "hardwareSpecs": [{"property": "VRAM", "value": "24GB GDDR6X"}, {"property": "Cores", "value": "16384 CUDA"}, {"property": "TDP", "value": "450W"}, {"property": "Interface", "value": "PCIe 4.0 x16"}], "negotiationRules": {"isNegotiable": true, "floorPrice": 0.05, "maxDiscountPercentage": 5}, "agentSalesInstructions": "Focus on the 24GB VRAM for both gaming and creative workflows (rendering, AI). Mention it is the current performance king.", "categories": [{"_type": "reference", "_ref": "cat-gpu"}], "embeddings": [0.9, -0.8, 0.7, 0.2, -0.1]},
  {"_id": "prod-framework-16", "_type": "product", "name": "Framework Laptop 16 (DIY)", "sku": "FW-16-DIY", "slug": {"_type": "slug", "current": "framework-laptop-16-diy"}, "status": "active", "stock": 15, "price": 0.1, "machineDescription": "The Framework Laptop 16 is a high-performance, modular laptop. Featuring a user-replaceable GPU module, expandable I/O with Expansion Cards, and repairable design.", "hardwareSpecs": [{"property": "CPU", "value": "AMD Ryzen 7040 Series"}, {"property": "Display", "value": "16\" 2560x1600 165Hz"}, {"property": "GPU", "value": "Radeon RX 7700S (Modular)"}, {"property": "Weight", "value": "2.1kg - 2.4kg"}], "negotiationRules": {"isNegotiable": false}, "agentSalesInstructions": "Emphasize repairability, modularity, and the 'right to repair' philosophy. Explain the Expansion Card system for I/O customization.", "categories": [{"_type": "reference", "_ref": "cat-laptops"}], "embeddings": [-0.1, 0.5, 0.3, 0.2, 0.8]},
  {"_id": "prod-keychron-q1", "_type": "product", "name": "Keychron Q1 Pro", "sku": "KC-Q1-PRO", "slug": {"_type": "slug", "current": "keychron-q1-pro"}, "status": "active", "stock": 60, "price": 0.1, "machineDescription": "The Q1 Pro is a wireless QMK/VIA custom mechanical keyboard with a full aluminum body. 75% layout, gasket mount design, and hot-swappable switches.", "hardwareSpecs": [{"property": "Layout", "value": "75%"}, {"property": "Connectivity", "value": "Bluetooth 5.1 / Wired"}, {"property": "Polling Rate", "value": "1000Hz (Wired)"}, {"property": "Body", "value": "CNC Aluminum"}], "negotiationRules": {"isNegotiable": true, "floorPrice": 0.05, "maxDiscountPercentage": 10}, "agentSalesInstructions": "Highlight the premium build quality, QMK/VIA programmability, and the gasket mount for a better typing experience. Mention the hot-swap capability for easy switch customization.", "categories": [{"_type": "reference", "_ref": "cat-peripherals"}], "embeddings": [0.2, 0.3, -0.5, -0.4, 0.9]}
];

const allData = [...categories, ...originalProducts, ...products];

const output = allData.map(d => JSON.stringify(d)).join('\n') + '\n';

fs.writeFileSync('/home/Veldrine/storefront/studio-the-storefront/data/seed.ndjson', output);
console.log(`Generated ${allData.length} records to seed.ndjson`);

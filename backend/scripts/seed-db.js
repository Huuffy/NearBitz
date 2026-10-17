/**
 * Seed industries and product_categories.
 * 15 industries → ~120 product groups (L1) → ~600 specific products (L2).
 * L2 keywords drive both ERP normalization and salesman search matching.
 *
 * Depth rationale: "Impellers" not "Pumps" — salesmen search for the exact
 * component they sell, not the industry bucket.
 *
 * Safe to re-run (INSERT WHERE NOT EXISTS).
 */
const pool = require('../db/pool');

const INDUSTRIES = [
    { name: 'Steel & Metals',           slug: 'steel-metals',    icon: 'construct-outline' },
    { name: 'Construction',             slug: 'construction',    icon: 'business-outline' },
    { name: 'Chemicals & Polymers',     slug: 'chemicals',       icon: 'flask-outline' },
    { name: 'Electrical & Electronics', slug: 'electrical',      icon: 'flash-outline' },
    { name: 'Textiles & Apparel',       slug: 'textiles',        icon: 'color-palette-outline' },
    { name: 'Automotive',               slug: 'automotive',      icon: 'car-outline' },
    { name: 'Pharmaceuticals',          slug: 'pharma',          icon: 'medical-outline' },
    { name: 'Agriculture & Agro',       slug: 'agriculture',     icon: 'leaf-outline' },
    { name: 'Packaging & Printing',     slug: 'packaging',       icon: 'cube-outline' },
    { name: 'Machinery & Equipment',    slug: 'machinery',       icon: 'settings-outline' },
    { name: 'Food & Beverages',         slug: 'food-beverage',   icon: 'restaurant-outline' },
    { name: 'Rubber & Plastics',        slug: 'rubber-plastics', icon: 'ellipse-outline' },
    { name: 'Paper & Pulp',             slug: 'paper',           icon: 'document-outline' },
    { name: 'IT & Technology',          slug: 'it-tech',         icon: 'laptop-outline' },
    { name: 'Logistics & Transport',    slug: 'logistics',       icon: 'car-sport-outline' },
];

// ─── L1: Product groups [industry_slug, name, slug, keywords] ─────────────────
const L1 = [
    // Steel & Metals
    ['steel-metals', 'Flat Rolled Products',          'flat-rolled',       ['flat', 'sheet', 'coil', 'plate', 'strip', 'hr', 'cr', 'galvanized']],
    ['steel-metals', 'Long Products',                  'long-products',     ['long product', 'bar', 'rod', 'rebar', 'beam', 'angle', 'channel', 'joist']],
    ['steel-metals', 'Pipes & Tubes',                  'pipes-tubes',       ['pipe', 'tube', 'erw', 'hollow section', 'seamless']],
    ['steel-metals', 'Stainless Steel',                'stainless-steel',   ['stainless', 'ss', '304', '316', '202', 'duplex steel']],
    ['steel-metals', 'Castings & Forgings',            'castings-forgings', ['casting', 'forging', 'cast iron', 'ductile iron', 'die cast']],
    ['steel-metals', 'Non-Ferrous Metals',             'non-ferrous',       ['copper', 'brass', 'aluminium', 'zinc', 'lead', 'tin', 'bronze', 'nickel']],
    ['steel-metals', 'Electrodes & Consumables',       'electrodes',        ['electrode', 'welding rod', 'flux', 'mig wire', 'tig wire', 'brazing']],
    ['steel-metals', 'Fasteners & Hardware',           'fasteners',         ['bolt', 'nut', 'screw', 'fastener', 'anchor', 'stud', 'washer', 'rivet']],
    ['steel-metals', 'Wire & Wire Mesh',               'wire-mesh',         ['wire', 'wire mesh', 'chain link', 'binding wire', 'gi wire', 'barbed wire']],

    // Construction
    ['construction', 'Cement & Ready-Mix Concrete',    'cement-rmc',        ['cement', 'opc', 'ppc', 'rmc', 'ready mix', 'concrete mix', '53 grade', '43 grade']],
    ['construction', 'Bricks & Blocks',                'bricks-blocks',     ['brick', 'block', 'aac', 'fly ash brick', 'clay brick', 'interlocking']],
    ['construction', 'Tiles & Flooring',               'tiles-flooring',    ['tile', 'vitrified', 'ceramic tile', 'floor tile', 'wall tile', 'marble', 'granite', 'mosaic']],
    ['construction', 'Plywood, MDF & Boards',          'wood-boards',       ['plywood', 'mdf', 'particle board', 'blockboard', 'veneer', 'flush door', 'hdhmr']],
    ['construction', 'Sanitaryware & Fittings',        'sanitaryware',      ['wash basin', 'wc', 'closet', 'urinal', 'faucet', 'cistern', 'shower', 'bathtub']],
    ['construction', 'Paints & Coatings',              'paints',            ['paint', 'primer', 'putty', 'enamel', 'emulsion', 'epoxy coat', 'anticorrosion', 'intumescent']],
    ['construction', 'Waterproofing & Sealants',       'waterproofing',     ['waterproof', 'sealant', 'grout', 'bitumen', 'membrane', 'caulk', 'expansion joint']],
    ['construction', 'Hardware & Door Fittings',       'hardware',          ['hinge', 'lock', 'handle', 'tower bolt', 'door closer', 'window fitting', 'glass fitting']],
    ['construction', 'Aggregates & Sand',              'aggregates',        ['aggregate', 'sand', 'm-sand', 'gravel', 'crushed stone', 'grit', 'quarry']],
    ['construction', 'Scaffolding & Formwork',         'scaffolding',       ['scaffolding', 'formwork', 'shuttering', 'prop', 'staging', 'centering']],

    // Chemicals & Polymers
    ['chemicals', 'Industrial Acids & Alkalis',        'acids-alkalis',     ['acid', 'alkali', 'caustic soda', 'sulphuric acid', 'hydrochloric acid', 'nitric acid', 'phosphoric', 'sodium hydroxide']],
    ['chemicals', 'Solvents & Thinners',               'solvents',          ['solvent', 'thinner', 'acetone', 'methanol', 'ethanol', 'isopropyl', 'toluene', 'xylene', 'naphtha']],
    ['chemicals', 'Polymers & Resins (Raw)',            'polymers-raw',      ['polymer', 'resin', 'pvc resin', 'hdpe', 'ldpe', 'lldpe', 'pp', 'abs', 'pet', 'polycarbonate', 'nylon', 'epoxy resin']],
    ['chemicals', 'Adhesives & Sealants',              'adhesives',         ['adhesive', 'glue', 'epoxy adhesive', 'cyanoacrylate', 'phenyl', 'fevicol', 'ms polymer']],
    ['chemicals', 'Dyes & Pigments',                   'dyes-pigments',     ['dye', 'pigment', 'colorant', 'reactive dye', 'disperse dye', 'vat dye', 'titanium dioxide', 'carbon black']],
    ['chemicals', 'Lubricants & Cutting Fluids',       'lubricants',        ['lubricant', 'grease', 'cutting oil', 'coolant', 'hydraulic oil', 'gear oil', 'compressor oil', 'spindle oil']],
    ['chemicals', 'Water Treatment Chemicals',         'water-treatment',   ['water treatment', 'coagulant', 'flocculant', 'antiscalant', 'biocide', 'chlorine', 'alum', 'ferric sulphate']],
    ['chemicals', 'Specialty Chemicals',               'specialty-chem',    ['specialty chemical', 'surfactant', 'defoamer', 'wetting agent', 'emulsifier', 'catalyst', 'crosslinker']],
    ['chemicals', 'Fertilizers & Agrochemicals',       'fertilizers',       ['fertilizer', 'urea', 'dap', 'npk', 'potash', 'pesticide', 'insecticide', 'herbicide', 'fungicide']],

    // Electrical & Electronics
    ['electrical', 'Cables & Wires',                   'cables-wires',      ['cable', 'wire', 'armoured cable', 'fr wire', 'power cable', 'control cable', 'instrumentation cable', 'co-axial', 'optical fibre']],
    ['electrical', 'Switchgear & Protection',          'switchgear',        ['switchgear', 'mcb', 'mccb', 'acb', 'vcb', 'isolator', 'fuse', 'contactor', 'relay', 'overload relay', 'circuit breaker']],
    ['electrical', 'Motors & Drives',                  'motors-drives',     ['motor', 'vfd', 'variable frequency drive', 'servo motor', 'stepper motor', 'ac drive', 'dc drive', 'soft starter']],
    ['electrical', 'Transformers & Panels',            'transformers',      ['transformer', 'distribution transformer', 'control panel', 'mcc panel', 'plc panel', 'ups', 'inverter', 'rectifier']],
    ['electrical', 'Lighting',                         'lighting',          ['led', 'lighting', 'tube light', 'high bay', 'street light', 'flood light', 'luminaire', 'lamp', 'driver']],
    ['electrical', 'Sensors & Instrumentation',        'sensors',           ['sensor', 'transmitter', 'pressure gauge', 'temperature sensor', 'flow meter', 'level indicator', 'thermocouple', 'rtd', 'plc', 'scada']],
    ['electrical', 'PCBs & Electronic Components',    'pcb-components',    ['pcb', 'printed circuit board', 'capacitor', 'resistor', 'ic', 'microcontroller', 'diode', 'transistor', 'connector', 'relay']],
    ['electrical', 'Batteries & Energy Storage',       'batteries',         ['battery', 'inverter battery', 'lithium battery', 'ups battery', 'smf', 'lead acid', 'energy storage']],
    ['electrical', 'Conduits & Accessories',           'conduits',          ['conduit', 'trunking', 'cable tray', 'raceway', 'earthing', 'gland', 'junction box', 'db box']],

    // Textiles
    ['textiles', 'Yarn',                               'yarn',              ['yarn', 'thread', 'cotton yarn', 'polyester yarn', 'viscose yarn', 'nylon yarn', 'blended yarn', 'spun yarn']],
    ['textiles', 'Woven & Knitted Fabric',             'fabric',            ['fabric', 'cloth', 'woven', 'knitted', 'grey cloth', 'shirting', 'suiting', 'denim', 'twill', 'canvas']],
    ['textiles', 'Technical Textiles',                 'technical-textiles',['technical textile', 'geotextile', 'agrotextile', 'filtration fabric', 'nonwoven', 'felt', 'tarpaulin', 'canvas']],
    ['textiles', 'Dyes & Auxiliaries',                 'textile-chemicals', ['textile chemical', 'sizing', 'finishing agent', 'softener', 'optical brightener', 'fabric dye', 'printing paste']],
    ['textiles', 'Apparel & Made-ups',                 'apparel',           ['garment', 'apparel', 't-shirt', 'trouser', 'kurta', 'saree', 'bedsheet', 'towel', 'uniform']],
    ['textiles', 'Needles, Bobbins & Accessories',     'textile-accessories',['needle', 'bobbin', 'shuttle', 'card clothing', 'ring traveller', 'elastic', 'zipper', 'velcro', 'interlining']],

    // Automotive
    ['automotive', 'Engine Components',                'engine-components', ['piston', 'cylinder', 'crankshaft', 'camshaft', 'engine valve', 'connecting rod', 'liner', 'gasket', 'timing belt', 'chain']],
    ['automotive', 'Transmission & Drivetrain',        'transmission',      ['gearbox', 'gear', 'clutch', 'driveshaft', 'propeller shaft', 'differential', 'axle', 'cv joint', 'universal joint']],
    ['automotive', 'Braking Systems',                  'brakes',            ['brake', 'brake pad', 'brake disc', 'brake drum', 'caliper', 'brake lining', 'abs sensor']],
    ['automotive', 'Electrical Auto Parts',            'auto-electrical',   ['alternator', 'starter motor', 'ignition', 'spark plug', 'battery', 'wiring harness', 'ecu', 'sensor']],
    ['automotive', 'Suspension & Steering',            'suspension',        ['suspension', 'shock absorber', 'spring', 'control arm', 'tie rod', 'steering rack', 'ball joint', 'bushing']],
    ['automotive', 'Tyres & Wheels',                   'tyres',             ['tyre', 'tire', 'tube', 'rim', 'wheel', 'radial', 'bias ply', 'solid tyre', 'alloy wheel']],
    ['automotive', 'Filters',                          'auto-filters',      ['oil filter', 'air filter', 'fuel filter', 'cabin filter', 'hydraulic filter', 'coolant filter']],
    ['automotive', 'Body Parts & Panels',              'body-parts',        ['bumper', 'fender', 'door panel', 'bonnet', 'roof panel', 'mirror', 'headlamp', 'tail lamp', 'grille']],
    ['automotive', 'Lubricants & Fluids (Auto)',       'auto-fluids',       ['engine oil', 'gear oil', 'brake fluid', 'coolant', 'transmission oil', 'power steering fluid']],

    // Pharmaceuticals
    ['pharma', 'Active Pharmaceutical Ingredients',    'api',               ['api', 'bulk drug', 'active ingredient', 'drug substance', 'synthesis', 'fermentation product']],
    ['pharma', 'Pharma Excipients',                    'excipients',        ['excipient', 'binder', 'filler', 'lubricant excipient', 'disintegrant', 'coating material', 'microcrystalline cellulose', 'lactose', 'starch']],
    ['pharma', 'Formulations (Oral)',                  'oral-formulations', ['tablet', 'capsule', 'syrup', 'suspension', 'oral', 'sachet dosage', 'effervescent', 'chewable']],
    ['pharma', 'Formulations (Injectable)',            'injectables',       ['injection', 'vial', 'ampoule', 'iv infusion', 'lyophilized', 'prefilled syringe', 'large volume parenteral']],
    ['pharma', 'Medical Devices & Surgical',           'medical-devices',   ['surgical instrument', 'suture', 'glove', 'syringe', 'cannula', 'stent', 'catheter', 'implant', 'orthopaedic']],
    ['pharma', 'Pharma Packaging',                     'pharma-packaging',  ['blister', 'alu foil', 'pvdc', 'hdpe bottle', 'amber bottle', 'vial', 'ampoule', 'sachets', 'strip pack']],
    ['pharma', 'Lab Reagents & Chemicals',             'lab-chemicals',     ['reagent', 'lab chemical', 'analytical grade', 'hplc solvent', 'culture media', 'buffer solution', 'standard solution']],

    // Agriculture
    ['agriculture', 'Seeds',                           'seeds',             ['seed', 'hybrid seed', 'vegetable seed', 'paddy seed', 'cotton seed', 'maize seed', 'soybean seed']],
    ['agriculture', 'Crop Protection',                 'crop-protection',   ['pesticide', 'insecticide', 'fungicide', 'herbicide', 'weedicide', 'nematicide', 'bio pesticide']],
    ['agriculture', 'Fertilizers',                     'agri-fertilizers',  ['fertilizer', 'urea', 'dap', 'npk', 'potash', 'micronutrient', 'zinc sulphate', 'boron', 'biofertilizer']],
    ['agriculture', 'Irrigation & Drip Systems',       'irrigation',        ['drip irrigation', 'sprinkler', 'pump for irrigation', 'pipe irrigation', 'fertigation', 'microjet', 'emitter']],
    ['agriculture', 'Agro Machinery',                  'agro-machinery',    ['tractor', 'cultivator', 'harvester', 'thresher', 'seed drill', 'sprayer', 'rotavator', 'plough']],
    ['agriculture', 'Animal Feed & Nutrition',         'animal-feed',       ['animal feed', 'cattle feed', 'poultry feed', 'fish meal', 'soya meal', 'bypass protein', 'premix']],

    // Packaging & Printing
    ['packaging', 'Corrugated Boxes & Cartons',        'corrugated',        ['corrugated box', 'carton', '3 ply', '5 ply', '7 ply', 'kraft box', 'die cut box', 'mono carton']],
    ['packaging', 'Flexible Packaging',                'flexible-pack',     ['flexible packaging', 'pouch', 'sachet', 'laminate', 'stand-up pouch', 'film', 'metalized film', 'retort pouch']],
    ['packaging', 'Rigid Plastic Packaging',           'rigid-plastic',     ['bottle', 'container', 'jar', 'tub', 'crate', 'pail', 'drum', 'hdpe drum', 'ibc', 'jerrycan']],
    ['packaging', 'Glass Packaging',                   'glass-pack',        ['glass bottle', 'glass jar', 'vial glass', 'glass ampoule', 'glass container']],
    ['packaging', 'Metal Packaging & Tins',            'metal-pack',        ['tin', 'can', 'metal container', 'aerosol can', 'metal drum', 'steel drum', 'composite can']],
    ['packaging', 'Labels & Tags',                     'labels',            ['label', 'sticker', 'barcode label', 'self-adhesive', 'shrink sleeve', 'tag', 'rfid label']],
    ['packaging', 'Strapping & Stretch Film',          'strapping',         ['strapping', 'stretch film', 'pallet wrap', 'binding strap', 'pp strap', 'pet strap', 'bubble wrap', 'foam sheet']],
    ['packaging', 'Printing Services & Materials',     'printing',          ['printing', 'offset print', 'flexo print', 'digital print', 'ink', 'printing plate', 'gravure', 'screen printing']],

    // Machinery & Equipment
    ['machinery', 'Pumps',                             'pumps',             ['pump', 'centrifugal pump', 'submersible pump', 'reciprocating pump', 'gear pump', 'diaphragm pump', 'peristaltic pump', 'slurry pump']],
    ['machinery', 'Pump Parts & Components',           'pump-parts',        ['impeller', 'pump casing', 'volute', 'mechanical seal', 'pump shaft', 'wear ring', 'bearing housing', 'pump sleeve', 'diffuser', 'back plate', 'pump cover', 'stuffing box', 'lantern ring']],
    ['machinery', 'Valves',                            'valves',            ['valve', 'gate valve', 'ball valve', 'butterfly valve', 'check valve', 'needle valve', 'globe valve', 'diaphragm valve', 'safety valve', 'pressure relief valve', 'solenoid valve']],
    ['machinery', 'Valve Parts',                       'valve-parts',       ['valve seat', 'valve disc', 'valve body', 'valve stem', 'handwheel', 'bonnet', 'packing ring', 'gland follower', 'valve trim']],
    ['machinery', 'Compressors & Blowers',             'compressors',       ['compressor', 'air compressor', 'screw compressor', 'reciprocating compressor', 'blower', 'vacuum pump', 'roots blower', 'centrifugal blower']],
    ['machinery', 'Compressor Parts',                  'compressor-parts',  ['compressor valve', 'piston ring', 'piston pin', 'connecting rod kit', 'cylinder liner', 'crankshaft', 'compressor gasket', 'oil separator', 'air filter element']],
    ['machinery', 'Gears & Gearboxes',                 'gearboxes',         ['gearbox', 'gear', 'worm gear', 'helical gear', 'bevel gear', 'planetary gear', 'rack and pinion', 'speed reducer', 'torque converter']],
    ['machinery', 'Bearings',                          'bearings',          ['bearing', 'ball bearing', 'roller bearing', 'taper bearing', 'spherical bearing', 'thrust bearing', 'pillow block', 'plummer block', 'bush bearing']],
    ['machinery', 'Seals & Gaskets',                   'seals-gaskets',     ['seal', 'gasket', 'o-ring', 'mechanical seal', 'oil seal', 'v-ring', 'lip seal', 'packing', 'gland packing', 'spiral wound gasket', 'rtj gasket', 'ptfe gasket']],
    ['machinery', 'Heat Exchangers',                   'heat-exchangers',   ['heat exchanger', 'shell and tube', 'plate heat exchanger', 'condenser', 'reboiler', 'cooler', 'chiller coil', 'radiator']],
    ['machinery', 'Boilers & Pressure Vessels',        'boilers',           ['boiler', 'steam boiler', 'pressure vessel', 'autoclave', 'reactor vessel', 'storage tank', 'agitator', 'jacketed vessel']],
    ['machinery', 'Material Handling Equipment',       'material-handling', ['conveyor', 'belt conveyor', 'screw conveyor', 'bucket elevator', 'hoist', 'crane', 'forklift', 'stacker', 'pallet truck', 'chain block']],
    ['machinery', 'Filters & Filtration',              'filtration',        ['filter', 'bag filter', 'cartridge filter', 'sand filter', 'oil filter', 'strainer', 'basket filter', 'self-cleaning filter', 'micron filter']],
    ['machinery', 'Agitators & Mixers',                'agitators',         ['agitator', 'mixer', 'stirrer', 'homogenizer', 'disperser', 'blender', 'paddle mixer', 'ribbon blender', 'sigma mixer']],
    ['machinery', 'Couplings & Drive Systems',         'couplings',         ['coupling', 'flexible coupling', 'jaw coupling', 'disc coupling', 'grid coupling', 'belt drive', 'v-belt', 'flat belt', 'chain drive', 'sprocket', 'pulley']],

    // Food & Beverages
    ['food-beverage', 'Food Ingredients',              'food-ingredients',  ['food ingredient', 'flavour', 'colour', 'preservative', 'emulsifier', 'thickener', 'starch', 'protein', 'yeast extract', 'enzyme']],
    ['food-beverage', 'Grains & Pulses',               'grains',            ['wheat', 'rice', 'maize', 'soybean', 'dal', 'lentil', 'chickpea', 'grain', 'cereal', 'flour', 'atta', 'maida', 'suji']],
    ['food-beverage', 'Oils & Fats',                   'edible-oils',       ['edible oil', 'palm oil', 'sunflower oil', 'soybean oil', 'groundnut oil', 'vanaspati', 'ghee', 'butter', 'margarine', 'shortening']],
    ['food-beverage', 'Dairy Products',                'dairy',             ['milk', 'dairy', 'cheese', 'paneer', 'skimmed milk powder', 'whey', 'butter', 'cream', 'curd']],
    ['food-beverage', 'Beverages',                     'beverages',         ['beverage', 'juice', 'soft drink', 'water', 'energy drink', 'tea', 'coffee', 'beer', 'spirits']],
    ['food-beverage', 'Spices & Condiments',           'spices',            ['spice', 'masala', 'pepper', 'cumin', 'turmeric', 'chilli', 'coriander', 'garam masala', 'sauce', 'ketchup', 'pickle']],
    ['food-beverage', 'Food Processing Machinery',     'food-machinery',    ['food processing machine', 'filling machine', 'sealing machine', 'mixing machine', 'pasteurizer', 'homogenizer', 'evaporator', 'dryer']],
    ['food-beverage', 'Cold Chain & Refrigeration',    'cold-chain',        ['cold storage', 'refrigeration', 'freezer', 'chiller', 'blast freezer', 'refrigerated truck', 'reefer container', 'cold room panel']],

    // Rubber & Plastics
    ['rubber-plastics', 'Rubber Compounds & Sheets',   'rubber-compounds',  ['rubber compound', 'natural rubber', 'sbr', 'nbr', 'epdm', 'neoprene', 'silicone rubber', 'rubber sheet', 'rubber sponge']],
    ['rubber-plastics', 'Rubber Products',             'rubber-products',   ['rubber ring', 'rubber seal', 'rubber pad', 'rubber gasket', 'rubber hose', 'rubber lining', 'anti-vibration mount']],
    ['rubber-plastics', 'Rubber Belts & Conveyors',    'rubber-belts',      ['rubber belt', 'conveyor belt', 'v-belt', 'timing belt', 'flat belt', 'ribbed belt']],
    ['rubber-plastics', 'Plastic Compounds & Granules','plastic-compounds', ['plastic granule', 'masterbatch', 'compound', 'plastic raw material', 'regrind', 'plastic alloy']],
    ['rubber-plastics', 'Plastic Moulded Products',    'plastic-moulded',   ['injection moulded', 'blow moulded', 'plastic component', 'plastic part', 'plastic housing', 'plastic fitting']],
    ['rubber-plastics', 'Hoses & Flexible Tubing',     'hoses',             ['hose', 'flexible hose', 'industrial hose', 'hydraulic hose', 'food grade hose', 'suction hose', 'discharge hose', 'ptfe hose']],

    // Paper & Pulp
    ['paper', 'Printing & Writing Paper',              'writing-paper',     ['printing paper', 'writing paper', 'copier paper', 'bond paper', 'maplitho', 'art paper', 'coated paper']],
    ['paper', 'Kraft & Packaging Paper',               'kraft-paper',       ['kraft paper', 'kraft board', 'duplex board', 'grey board', 'corrugated medium', 'liner', 'test liner']],
    ['paper', 'Tissue & Specialty Paper',              'tissue-paper',      ['tissue', 'tissue paper', 'toilet roll', 'napkin', 'filter paper', 'crepe paper', 'release paper', 'silicone paper']],
    ['paper', 'Pulp & Raw Materials',                  'pulp',              ['pulp', 'wood pulp', 'bagasse pulp', 'waste paper', 'recycled fibre', 'deinked pulp']],
    ['paper', 'Chemicals for Paper',                   'paper-chemicals',   ['rosin', 'alum', 'sizing chemical', 'retention aid', 'wet strength resin', 'defoamer', 'biocide for paper']],

    // IT & Technology
    ['it-tech', 'IT Hardware',                         'it-hardware',       ['server', 'workstation', 'laptop', 'desktop', 'storage', 'networking equipment', 'switch', 'router', 'firewall']],
    ['it-tech', 'Industrial Automation',               'automation',        ['plc', 'scada', 'dcs', 'hmi', 'industrial pc', 'automation controller', 'servo system', 'motion control', 'robot']],
    ['it-tech', 'Software & Licenses',                 'software',          ['erp', 'software', 'cloud', 'saas', 'license', 'it solution', 'mes', 'crm', 'scm']],

    // Logistics
    ['logistics', 'Transport Vehicles',                'vehicles',          ['truck', 'trailer', 'lorry', 'container truck', 'tanker', 'refrigerated vehicle', 'tipper', 'pickup']],
    ['logistics', 'Warehousing Equipment',             'warehouse-equip',   ['racking', 'shelving', 'pallet', 'stretch wrapper', 'dock leveller', 'loading bay', 'weighbridge', 'barcode scanner']],
    ['logistics', 'Packaging for Logistics',           'logistics-pack',    ['pp bag', 'hdpe bag', 'jute bag', 'pallet', 'big bag', 'fibc', 'stretch film', 'strap']],
];

// ─── L2: Component-level specific products [L1_slug, name, slug, keywords] ────
const L2 = [
    // Steel flat
    ['flat-rolled',       'HR Coils & Sheets',                'hr-coils',           ['hr coil', 'hot rolled coil', 'hr sheet', 'hr plate', 'hot rolled plate']],
    ['flat-rolled',       'CR Coils & Sheets',                'cr-coils',           ['cr coil', 'cold rolled coil', 'cr sheet', 'cold rolled plate', 'crca']],
    ['flat-rolled',       'GI & GP Sheets & Coils',           'gi-sheets',          ['gi sheet', 'gi coil', 'galvanized sheet', 'gp coil', 'galvalume', 'color coated', 'ppgi']],
    ['flat-rolled',       'MS Plates',                        'ms-plates',          ['ms plate', 'mild steel plate', 'carbon steel plate', 'boiler plate', 'shipbuilding plate']],

    // Steel long
    ['long-products',     'TMT Steel Bars',                   'tmt-bars',           ['tmt', 'rebar', 'thermo mechanically treated', 'fe415', 'fe500', 'fe550', 'corrosion resistant tmt', 'crs tmt']],
    ['long-products',     'Structural Steel (Angles, Channels, Beams)', 'structural-steel', ['angle', 'channel', 'beam', 'joist', 'i-beam', 'h-beam', 'ismb', 'ismc', 'isjc', 'structural steel']],
    ['long-products',     'Wire Rods',                        'wire-rods',          ['wire rod', 'low carbon wire rod', 'high carbon wire rod', 'mild steel wire rod', 'q195', 'q235']],

    // Pipes & Tubes
    ['pipes-tubes',       'ERW / MS Pipes',                   'erw-ms-pipes',       ['erw pipe', 'ms pipe', 'welded pipe', 'black pipe', 'mild steel tube', 'hollow section', 'square tube', 'rectangular tube']],
    ['pipes-tubes',       'Seamless Pipes',                   'seamless-pipes',     ['seamless pipe', 'seamless tube', 'boiler tube', 'heat exchanger tube', 'api 5l', 'cs seamless']],
    ['pipes-tubes',       'PVC & CPVC Pipes',                 'pvc-pipes',          ['pvc pipe', 'upvc pipe', 'cpvc pipe', 'pvc fitting', 'upvc fitting', 'pvc column pipe']],
    ['pipes-tubes',       'HDPE & PP Pipes',                  'hdpe-pipes',         ['hdpe pipe', 'pp pipe', 'polyethylene pipe', 'hdpe fitting', 'pe pipe', 'dual wall', 'corrugated hdpe']],
    ['pipes-tubes',       'GI Pipes',                         'gi-pipes',           ['gi pipe', 'galvanized pipe', 'galvanized tube', 'medium class gi', 'heavy class gi']],
    ['pipes-tubes',       'SS Pipes & Tubes',                 'ss-pipes',           ['ss pipe', 'stainless steel pipe', 'ss tube', 'seamless ss pipe', 'welded ss pipe', '316 pipe', '304 pipe']],

    // Stainless Steel
    ['stainless-steel',   'SS Sheets & Plates',               'ss-sheets',          ['ss sheet', 'stainless steel sheet', 'ss plate', '304 sheet', '316 sheet', '202 sheet', 'mirror finish ss', 'hairline ss']],
    ['stainless-steel',   'SS Fittings & Flanges',            'ss-fittings',        ['ss fitting', 'ss flange', 'stainless elbow', 'ss tee', 'ss reducer', 'ss cap', 'ss weld neck flange']],

    // Castings
    ['castings-forgings', 'Grey & SG Iron Castings',          'iron-castings',      ['grey iron casting', 'sg iron', 'ductile iron casting', 'malleable iron', 'cast iron pump part', 'ci casting']],
    ['castings-forgings', 'Steel Castings',                   'steel-castings',     ['steel casting', 'alloy steel casting', 'carbon steel casting', 'stainless casting', 'investment casting', 'lost wax casting']],
    ['castings-forgings', 'Aluminium Castings & Die Castings','aluminium-castings', ['aluminium casting', 'die casting', 'gravity die cast', 'pressure die cast', 'aluminium die cast', 'gravity cast']],
    ['castings-forgings', 'Forged Components',                'forgings',           ['forging', 'drop forging', 'closed die forging', 'open die forging', 'ring rolling', 'crankshaft forging', 'gear blank']],

    // Non-ferrous
    ['non-ferrous',       'Copper Products',                  'copper-products',    ['copper tube', 'copper rod', 'copper sheet', 'copper strip', 'copper busbar', 'etp copper', 'bus bar', 'earthing strip']],
    ['non-ferrous',       'Brass Products',                   'brass-products',     ['brass rod', 'brass tube', 'brass sheet', 'brass fitting', 'brass valve', 'brass insert', 'brass forging']],
    ['non-ferrous',       'Aluminium Products',               'aluminium-products', ['aluminium sheet', 'aluminium coil', 'aluminium extrusion', 'aluminium profile', 'aluminium section', 'al foil']],

    // Electrodes
    ['electrodes',        'Arc Welding Electrodes',           'arc-electrodes',     ['arc welding electrode', 'ms electrode', 'low hydrogen electrode', 'casting electrode', 'e6013', 'e7018', 'inconel electrode']],
    ['electrodes',        'MIG/TIG Wires & Consumables',      'mig-tig-wire',       ['mig wire', 'tig wire', 'co2 wire', 'flux core', 'tig rod', 'welding consumable', 'er70s6', 'er308', 'er316']],

    // Pump parts (deep component level — this is the "impellers" level)
    ['pump-parts',        'Pump Impellers',                   'pump-impellers',     ['impeller', 'pump impeller', 'centrifugal impeller', 'semi-open impeller', 'closed impeller', 'ss impeller', 'ci impeller', 'bronze impeller', 'vortex impeller', 'chopper impeller']],
    ['pump-parts',        'Pump Casings & Volutes',           'pump-casings',       ['pump casing', 'volute', 'pump body', 'suction casing', 'discharge casing', 'back plate', 'casing cover']],
    ['pump-parts',        'Mechanical Seals',                 'mechanical-seals',   ['mechanical seal', 'cartridge seal', 'split seal', 'single spring seal', 'multi spring seal', 'bellows seal', 'burgmann seal', 'crane seal', 'john crane seal']],
    ['pump-parts',        'Pump Shafts & Sleeves',            'pump-shafts',        ['pump shaft', 'shaft sleeve', 'pump spindle', 'impeller nut', 'sleeve bearing', 'shaft protection sleeve']],
    ['pump-parts',        'Wear Rings & Bushings',            'wear-rings',         ['wear ring', 'mouth ring', 'casing ring', 'impeller ring', 'throat bushing', 'line shaft bearing', 'column pipe bushing']],
    ['pump-parts',        'Stuffing Box & Gland Packing',     'gland-packing',      ['gland packing', 'stuffing box', 'packing ring', 'lantern ring', 'gland follower', 'ptfe packing', 'graphite packing', 'braided packing']],
    ['pump-parts',        'Pump Bearings & Bracket',          'pump-bearings',      ['pump bearing', 'bearing bracket', 'bearing housing', 'thrust bearing', 'radial bearing', 'angular contact bearing', 'pedestal bearing']],
    ['pump-parts',        'Submersible Motor Parts',          'submersible-parts',  ['submersible motor', 'submersible shaft', 'submersible impeller', 'motor winding', 'stator', 'rotor', 'sand fighter', 'diffuser submersible']],

    // Valve parts
    ['valve-parts',       'Valve Seats & Discs',              'valve-seats',        ['valve seat', 'seat ring', 'valve disc', 'valve plate', 'wedge disc', 'ball valve seat', 'ptfe seat', 'metal seat']],
    ['valve-parts',       'Valve Stems & Actuators',          'valve-stems',        ['valve stem', 'valve spindle', 'manual actuator', 'gear operator', 'pneumatic actuator', 'electric actuator', 'handwheel']],
    ['valve-parts',       'Valve Bodies & Bonnets',           'valve-bodies',       ['valve body', 'bonnet', 'yoke', 'packing box', 'end cap', 'valve flange', 'flanged body', 'screwed body']],

    // Compressor parts
    ['compressor-parts',  'Compressor Valves',                'compressor-valves',  ['compressor valve', 'suction valve', 'delivery valve', 'plate valve', 'ring valve', 'reed valve', 'valve assembly']],
    ['compressor-parts',  'Piston Rings & Rods',              'piston-rings',       ['piston ring', 'piston rod', 'piston pin', 'crosshead', 'rider ring', 'compression ring', 'oil scraper ring']],
    ['compressor-parts',  'Compressor Filters & Separators',  'comp-filters',       ['air filter element', 'oil separator', 'coalescer', 'air dryer filter', 'precision filter', 'inline filter']],

    // Bearings detail
    ['bearings',          'Ball Bearings',                    'ball-bearings',      ['ball bearing', 'deep groove ball bearing', 'angular contact', 'thrust ball bearing', 'self aligning ball', 'skf', 'fag', 'nsk', 'timken']],
    ['bearings',          'Roller Bearings',                  'roller-bearings',    ['roller bearing', 'cylindrical roller', 'spherical roller', 'tapered roller', 'needle roller', 'thrust roller']],
    ['bearings',          'Plummer Blocks & Housings',        'plummer-blocks',     ['plummer block', 'pillow block', 'bearing housing', 'snl housing', 'flange bearing', 'take-up unit']],

    // Seals & Gaskets
    ['seals-gaskets',     'O-Rings & Quad Rings',             'o-rings',            ['o-ring', 'quad ring', 'x-ring', 'viton o-ring', 'nbr o-ring', 'epdm o-ring', 'silicone o-ring', 'ptfe o-ring']],
    ['seals-gaskets',     'Spiral Wound & Ring Joint Gaskets','spiral-gaskets',     ['spiral wound gasket', 'rtj gasket', 'ring joint', 'kammprofile gasket', 'jacketed gasket']],
    ['seals-gaskets',     'Sheet Gaskets',                    'sheet-gaskets',      ['sheet gasket', 'compressed asbestos', 'graphite sheet', 'ptfe sheet gasket', 'neoprene sheet', 'full face gasket', 'raised face gasket']],
    ['seals-gaskets',     'Oil Seals & Lip Seals',            'oil-seals',          ['oil seal', 'lip seal', 'rotary shaft seal', 'tc seal', 'sc seal', 'freudenberg seal', 'trelleborg seal']],

    // Heat exchangers
    ['heat-exchangers',   'Shell & Tube Heat Exchangers',     'shell-tube-hex',     ['shell and tube heat exchanger', 'fixed tube sheet', 'u-tube', 'floating head', 'kettle reboiler', 'thermosiphon']],
    ['heat-exchangers',   'Plate Heat Exchangers',            'plate-hex',          ['plate heat exchanger', 'gasketed plate', 'brazed plate', 'welded plate', 'alfa laval', 'sondex', 'tranter']],
    ['heat-exchangers',   'Fin Fan & Air Coolers',            'air-coolers',        ['fin fan', 'air cooler', 'air fin cooler', 'finned tube', 'air blast cooler', 'forced draft cooler']],

    // Material handling
    ['material-handling', 'Belt Conveyors',                   'belt-conveyors',     ['belt conveyor', 'flat belt conveyor', 'troughed belt', 'conveyor belt', 'conveyor idler', 'pulley', 'take up']],
    ['material-handling', 'Screw & Drag Conveyors',           'screw-conveyors',    ['screw conveyor', 'drag chain conveyor', 'flight conveyor', 'en masse conveyor', 'tube conveyor']],
    ['material-handling', 'Bucket Elevators',                 'bucket-elevators',   ['bucket elevator', 'centrifugal bucket', 'continuous bucket', 'super capacity bucket', 'elevator bucket', 'head pulley']],
    ['material-handling', 'Hoists, Cranes & Lifting',         'lifting-equipment',  ['hoist', 'crane', 'eot crane', 'hob crane', 'chain block', 'wire rope hoist', 'electric hoist', 'jib crane', 'gantry crane']],

    // Boilers
    ['boilers',           'Steam Boilers',                    'steam-boilers',      ['fire tube boiler', 'water tube boiler', 'package boiler', 'fluidized bed boiler', 'thermic fluid heater', 'waste heat recovery boiler']],
    ['boilers',           'Pressure Vessels & Reactors',      'pressure-vessels',   ['pressure vessel', 'reactor', 'autoclave', 'storage tank', 'surge drum', 'column', 'separator', 'flash drum']],

    // Electrical cables
    ['cables-wires',      'LT Power Cables',                  'lt-cables',          ['lt cable', 'low tension cable', 'xlpe cable', 'pvc cable', 'armoured lt cable', '1.1kv cable', 'underground cable']],
    ['cables-wires',      'HT Cables',                        'ht-cables',          ['ht cable', 'high tension cable', '11kv cable', '33kv cable', '66kv cable', 'ehv cable', 'xlpe ht cable']],
    ['cables-wires',      'Control & Instrumentation Cables', 'control-cables',     ['control cable', 'instrumentation cable', 'thermocouple cable', 'compensating cable', 'shielded cable', 'multicore control']],
    ['cables-wires',      'Building Wires',                   'building-wires',     ['house wire', 'fr wire', 'hrfr wire', 'flat wire', 'round wire', 'single core flexible', 'batten lamp holder']],

    // Switchgear
    ['switchgear',        'MCBs & MCCBs',                     'mcb-mccb',           ['mcb', 'mccb', 'miniature circuit breaker', 'moulded case circuit breaker', 'rccb', 'rcbo', 'elcb']],
    ['switchgear',        'Contactors & Relays',              'contactors',         ['contactor', 'overload relay', 'thermal relay', 'auxiliary contactor', 'star delta starter', 'dol starter', 'soft starter contactor']],
    ['switchgear',        'HT Switchgear',                    'ht-switchgear',      ['vcb', 'acb', 'sf6 breaker', 'air circuit breaker', 'isolator', 'los', 'ht panel', 'ring main unit']],

    // Motors
    ['motors-drives',     'AC Induction Motors',              'ac-motors',          ['ac motor', 'induction motor', 'squirrel cage motor', 'flameproof motor', 'ex motor', 'tefc motor', 'crane duty motor']],
    ['motors-drives',     'Variable Frequency Drives',        'vfd-drives',         ['vfd', 'variable frequency drive', 'frequency inverter', 'ac drive', 'variable speed drive', 'abbe', 'siemens vfd', 'abb drive', 'danfoss']],

    // Pharma specific
    ['excipients',        'Excipients — Binders & Fillers',   'binders-fillers',    ['microcrystalline cellulose', 'mcc', 'lactose', 'mannitol', 'starch', 'pvp', 'hpmc', 'sodium starch glycolate', 'crospovidone']],
    ['excipients',        'Excipients — Coating & Film',      'coating-materials',  ['opadry', 'hpmc e5', 'ec', 'film coating', 'sugar coating', 'enteric coating', 'eudragit', 'cap', 'hpmc phthalate']],

    // Food ingredients
    ['food-ingredients',  'Food Colours & Flavours',          'food-colours',       ['food colour', 'food dye', 'natural colour', 'synthetic colour', 'flavour', 'food flavour', 'masking flavour', 'encapsulated flavour']],
    ['food-ingredients',  'Thickeners & Stabilizers',         'food-thickeners',    ['xanthan gum', 'guar gum', 'carrageenan', 'pectin', 'gelatin', 'agar agar', 'carboxymethyl cellulose', 'modified starch']],
    ['food-ingredients',  'Preservatives & Antioxidants',     'preservatives',      ['sodium benzoate', 'potassium sorbate', 'bha', 'bht', 'ascorbic acid', 'citric acid', 'tocopherol', 'rosemary extract']],

    // Rubber
    ['rubber-compounds',  'EPDM Rubber',                      'epdm-rubber',        ['epdm', 'epdm sheet', 'epdm gasket', 'epdm seal', 'epdm o-ring', 'epdm cord', 'epdm profile']],
    ['rubber-compounds',  'Silicone Rubber',                  'silicone-rubber',    ['silicone rubber', 'silicone sheet', 'silicone seal', 'silicone gasket', 'silicone o-ring', 'silicone hose', 'htv silicone']],
    ['rubber-compounds',  'Neoprene & NBR Rubber',            'nbr-neoprene',       ['nbr', 'nitrile rubber', 'neoprene', 'cr rubber', 'nbr sheet', 'nbr gasket', 'oil resistant rubber']],
    ['rubber-belts',      'Flat & V-Belts',                   'v-belts',            ['v-belt', 'wedge belt', 'banded belt', 'flat belt', 'classical v-belt', 'raw edge belt', 'cogged belt']],
    ['rubber-belts',      'Conveyor Belts',                   'conveyor-belts',     ['conveyor belt', 'rubber conveyor belt', 'chevron belt', 'oil resistant belt', 'heat resistant belt', 'rubber lagging', 'ep belt']],
    ['hoses',             'Industrial Hoses',                 'industrial-hoses',   ['industrial hose', 'suction hose', 'discharge hose', 'material handling hose', 'air hose', 'water hose', 'steam hose', 'food grade hose']],
    ['hoses',             'Hydraulic Hoses',                  'hydraulic-hoses',    ['hydraulic hose', 'high pressure hose', 'spiral hose', 'braided hose', 'hydraulic fitting', 'jic fitting', 'bsp fitting']],

    // Couplings
    ['couplings',         'Flexible Shaft Couplings',         'shaft-couplings',    ['jaw coupling', 'lovejoy coupling', 'grid coupling', 'disc coupling', 'oldham coupling', 'flexible coupling', 'gear coupling', 'tyre coupling']],
    ['couplings',         'Chain & Belt Drives',              'chain-drives',       ['roller chain', 'conveyor chain', 'sprocket', 'v-belt pulley', 'timing pulley', 'timing belt', 'toothed belt', 'synchronous belt']],

    // Agitators
    ['agitators',         'Turbine & Paddle Agitators',       'turbine-agitators',  ['turbine agitator', 'paddle agitator', 'anchor agitator', 'gate agitator', 'helical agitator', 'rushton turbine', 'pitched blade turbine']],
    ['agitators',         'High Shear Mixers',                'high-shear',         ['high shear mixer', 'rotor stator mixer', 'inline mixer', 'colloid mill', 'disperser', 'homogenizer', 'silverson']],

    // Filters
    ['filtration',        'Bag Filters',                      'bag-filters',        ['bag filter', 'pulse jet filter', 'shaker filter', 'reverse air filter', 'dust collector bag', 'filter bag material']],
    ['filtration',        'Cartridge Filters',                'cartridge-filters',  ['cartridge filter', 'filter cartridge', 'micron cartridge', 'pleated filter', 'string wound', 'pp cartridge', 'membrane cartridge']],

    // Packaging deep
    ['flexible-pack',     'Laminates & Pouches',              'laminates',          ['laminate', 'alu-pet laminate', 'pet-pe laminate', 'ny-pe laminate', 'multi layer laminate', 'retort laminate']],
    ['flexible-pack',     'Shrink Films',                     'shrink-films',       ['shrink film', 'pof shrink', 'pvc shrink', 'shrink sleeve label', 'shrink wrapping', 'heat shrink']],

    // Labels
    ['labels',            'Self-Adhesive Labels',             'self-adhesive',      ['self-adhesive label', 'ps label', 'psa label', 'paper label', 'pet label', 'pp label', 'varnish label', 'hot melt label']],

    // Gears
    ['gearboxes',         'Helical Gear Units',               'helical-gearbox',    ['helical gearbox', 'parallel shaft gearbox', 'inline gearbox', 'foot mounted gearbox', 'flange mounted gearbox', 'helical bevel']],
    ['gearboxes',         'Worm Gear Reducers',               'worm-gearbox',       ['worm gearbox', 'worm reducer', 'worm wheel', 'worm shaft', 'worm gear unit', 'hollow shaft worm gear']],

    // Automation
    ['automation',        'PLCs & Controllers',               'plc',                ['plc', 'programmable logic controller', 'siemens plc', 'allen bradley', 'mitsubishi plc', 'omron plc', 'schneider plc']],
    ['automation',        'HMI & Scada',                      'hmi-scada',          ['hmi', 'scada', 'operator panel', 'touch panel', 'industrial hmi', 'ipc', 'weintek', 'wonderware', 'ignition']],
];

// ─── Industry buy-side inference ───────────────────────────────────────────────
// Used by infer-company-products.js to populate company_products_buy
// "If a company's industry is X, they likely BUY these product categories"
// This is exported for use by infer-company-products.js
const INDUSTRY_BUYS = {
    'steel-metals':      ['coke', 'iron ore', 'electrodes', 'refractories', 'oxygen', 'natural gas', 'furnace oil', 'lubricants', 'cranes', 'conveyor belts', 'bearings', 'seals'],
    'construction':      ['tmt bars', 'cement', 'aggregates', 'sand', 'bricks', 'plywood', 'paints', 'pipes', 'electrical cables', 'switchgear'],
    'chemicals':         ['raw chemicals', 'solvents', 'storage tanks', 'agitators', 'pumps', 'heat exchangers', 'safety equipment', 'lab equipment'],
    'electrical':        ['copper', 'aluminium', 'pvc compound', 'xlpe compound', 'plastic granules', 'transformers', 'packaging'],
    'textiles':          ['yarn', 'dyes', 'chemicals', 'spare parts', 'spare needles', 'bobbins', 'packaging bags'],
    'automotive':        ['steel sheets', 'castings', 'forgings', 'rubber', 'paint', 'plastics', 'bearings', 'seals', 'packaging'],
    'pharma':            ['apis', 'excipients', 'packaging material', 'lab chemicals', 'hvac', 'clean room equipment', 'process equipment'],
    'agriculture':       ['seeds', 'fertilizers', 'pesticides', 'packaging bags', 'irrigation equipment', 'agro machinery'],
    'packaging':         ['paper', 'plastic films', 'inks', 'adhesives', 'machinery', 'cartons'],
    'machinery':         ['castings', 'forgings', 'steel', 'bearings', 'seals', 'fasteners', 'motors', 'electrical components'],
    'food-beverage':     ['packaging', 'food ingredients', 'colours', 'preservatives', 'machinery', 'cold chain'],
    'rubber-plastics':   ['rubber compound', 'plastic granules', 'carbon black', 'chemicals', 'moulds', 'machinery'],
    'paper':             ['pulp', 'chemicals', 'energy', 'machinery spares', 'packaging'],
    'it-tech':           ['electronic components', 'pcbs', 'packaging', 'machinery'],
    'logistics':         ['vehicles', 'tyres', 'lubricants', 'packaging', 'pallets', 'racking'],
};

module.exports = { INDUSTRY_BUYS };

// ─── Seed function ─────────────────────────────────────────────────────────────
async function seed() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Industries
        console.log('Seeding industries...');
        for (const ind of INDUSTRIES) {
            await client.query(
                `INSERT INTO industries (name, slug, icon_class) VALUES ($1, $2, $3)
                 ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, icon_class = EXCLUDED.icon_class`,
                [ind.name, ind.slug, ind.icon]
            );
        }

        const indRows = await client.query('SELECT id, slug FROM industries');
        const indSlugToId = new Map(indRows.rows.map(r => [r.slug, r.id]));

        const upsertCat = async (name, slug, level, keywords, parentId) => {
            await client.query(
                `INSERT INTO product_categories (name, slug, level, keywords, parent_id)
                 SELECT $1, $2::varchar, $3, $4, $5
                 WHERE NOT EXISTS (SELECT 1 FROM product_categories WHERE slug = $2::varchar)`,
                [name, slug, level, keywords, parentId || null]
            );
        };

        // L1 — product groups (parent = industry → we store parentId as null, link via industry join elsewhere)
        // Actually: L1 has no parent (they ARE the roots of the category tree).
        // Industry linkage is stored in company_industries, not in product_categories.
        console.log('Seeding L1 product groups...');
        for (const [, name, slug, keywords] of L1) {
            await upsertCat(name, slug, 1, keywords, null);
        }

        // Build slug → id map for L1 + L2 lookups
        const catRows = await client.query('SELECT id, slug FROM product_categories');
        const catSlugToId = new Map(catRows.rows.map(r => [r.slug, r.id]));

        // L2 — specific products (parent = L1)
        console.log('Seeding L2 specific products...');
        for (const [parentSlug, name, slug, keywords] of L2) {
            await upsertCat(name, slug, 2, keywords, catSlugToId.get(parentSlug) || null);
        }

        await client.query('COMMIT');

        const totalCats = L1.length + L2.length;
        console.log(`✓ Seeded ${INDUSTRIES.length} industries, ${totalCats} product categories (${L1.length} groups + ${L2.length} specific products)`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Seed failed:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) seed();

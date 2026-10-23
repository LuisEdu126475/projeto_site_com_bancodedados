/**
 * ============================================================================
 *  CARDÁPIO DA CAFETERIA
 * ============================================================================
 *  • Site SEM banco (versão estática): o cardápio publicado é exatamente este
 *    arquivo. Edite aqui e gere o site de novo com `npm run build:static`.
 *  • Site COM banco: este arquivo só preenche o cardápio na PRIMEIRA vez que o
 *    servidor sobe (banco vazio). Depois disso o cardápio é editado pelo
 *    painel /admin e este arquivo deixa de ser usado.
 *
 *  Regras rápidas (o sistema avisa se algo estiver errado):
 *   • slug: identificador da categoria, só letras minúsculas, números e hífen
 *   • price: preço em reais, com ponto decimal (24.5 = R$ 24,50)
 *   • origin, description, tastingNotes e volume são opcionais
 *   • isSignature: true destaca o item como "Assinatura da casa"
 *   • A ordem na tela é a mesma ordem deste arquivo
 * ============================================================================
 */

export default [
  {
    slug: 'assinaturas',
    name: 'Assinaturas da Casa',
    description: 'Criações autorais desenvolvidas pelos nossos baristas para exaltar cada safra.',
    items: [
      {
        name: 'Espresso Tonic Imperial',
        origin: 'Catuaí Vermelho · Mantiqueira de Minas',
        description:
          'Duplo ristretto extraído sobre água tônica botânica artesanal, infusão de casca de laranja-baía desidratada e ramo de alecrim fresco.',
        tastingNotes: 'Flor de laranjeira · Bergamota · Final cítrico refrescante',
        volume: '240 ml',
        price: 26.00,
        isSignature: true,
      },
      {
        name: 'Cortado no Caramelo de Missô',
        origin: 'Bourbon Amarelo · Carmo de Minas',
        description:
          'Espresso duplo equilibrado com redução artesanal de caramelo salgado ao missô branco e microespuma aveludada de leite.',
        tastingNotes: 'Caramelo tostado · Umami sutil · Avelã',
        volume: '130 ml',
        price: 24.00,
        isSignature: true,
      },
      {
        name: 'Cold Brew Barrel Aged',
        origin: 'Geisha · Fazenda Primavera (Chapada de Minas)',
        description:
          'Infusão a frio por 18 horas de grãos maturados em barris de carvalho antes da torra. Servido sobre esfera de gelo cristalino.',
        tastingNotes: 'Baunilha · Cacau nibs · Licor de ameixa',
        volume: '180 ml',
        price: 32.00,
        isSignature: true,
      },
      {
        name: 'Affogato ao Gelato de Fior di Latte',
        origin: 'Blend Nº 01 · Cerrado & Mogiana',
        description:
          'Gelato artesanal de creme fresco batido diariamente, afogado na hora por um espresso duplo quente e finalizado com praliné de pecã.',
        tastingNotes: 'Creme fresco · Chocolate 70% · Noz-pecã caramelizada',
        volume: '160 g',
        price: 29.00,
        isSignature: true,
      },
    ],
  },
  {
    slug: 'filtrados',
    name: 'Filtrados de Microlote',
    description: 'Lotes raros com pontuação 87+ SCA, extraídos sob encomenda no método que melhor revela seu terroir.',
    items: [
      {
        name: 'Hario V60 · Geisha Florada',
        origin: 'Fazenda Santa Margarida · Araponga, MG · 1.380 m',
        description:
          'Processamento lavado com fermentação controlada de 48h. Bebida de limpidez cristalina, corpo delicado de chá branco e acidez vibrante.',
        tastingNotes: 'Jasmim · Pêssego branco · Mel de laranjeira',
        volume: '200 ml',
        price: 28.00,
        isSignature: true,
      },
      {
        name: 'Origami Dripper · Arara Natural',
        origin: 'Sítio Alto da Serra · Piatã, Chapada Diamantina · 1.420 m',
        description:
          'Secagem lenta em terreiro suspenso à sombra. Doçura intensa e acidez málica elegante que evolui conforme a bebida esfria na taça.',
        tastingNotes: 'Frutas vermelhas · Maçã verde · Rapadura',
        volume: '200 ml',
        price: 26.00,
      },
      {
        name: 'Chemex · Paraíso Fermentado',
        origin: 'Fazenda Bom Retiro · São Sebastião da Grama, SP · 1.260 m',
        description:
          'Filtro triplo de papel que entrega uma xícara sedosa e aromática, ideal para apreciar em dois tempos — quente e morna.',
        tastingNotes: 'Maracujá doce · Damasco · Chá preto Darjeeling',
        volume: '250 ml',
        price: 29.00,
      },
      {
        name: 'Prensa Francesa · Mundo Novo',
        origin: 'Fazenda Sertãozinho · Cristina, MG · 1.290 m',
        description:
          'Imersão total em malha metálica que preserva os óleos essenciais do café. Textura licorosa e retrogosto prolongado.',
        tastingNotes: 'Melaço de cana · Amêndoas torradas · Cacau',
        volume: '320 ml',
        price: 25.00,
      },
    ],
  },
  {
    slug: 'espresso-bar',
    name: 'Espresso Bar',
    description: 'Extrações calibradas a cada manhã em La Marzocco Linea PB com água remineralizada sob medida.',
    items: [
      {
        name: 'Espresso Duplo',
        origin: 'Blend da Casa · Bourbon Amarelo & Catucaí 785',
        description:
          'Extração dupla curta e xaroposa, crema aveludada cor de avelã e equilíbrio clássico entre doçura, corpo e acidez baixa.',
        tastingNotes: 'Chocolate amargo · Avelã tostada · Caramelo',
        volume: '45 ml',
        price: 14.00,
      },
      {
        name: 'Flat White',
        origin: 'Duplo Ristretto · Leite integral fazenda local ou Aveia Barista',
        description:
          'Proporção australiana clássica: dois shots curtos envolvidos por camada fina e brilhante de microespuma a 62 °C.',
        tastingNotes: 'Ganache ao leite · Biscoito amanteigado',
        volume: '160 ml',
        price: 20.00,
      },
      {
        name: 'Cappuccino Italiano Clássico',
        origin: 'Blend da Casa · Cacau alcalino belga opcional',
        description:
          'Terços harmônicos de espresso, leite vaporizado e crema densa e elástica. Sem canela para preservar as notas da torra.',
        tastingNotes: 'Nozes · Caramelo · Creme doce',
        volume: '180 ml',
        price: 19.00,
      },
      {
        name: 'Latte de Baunilha de Madagascar',
        origin: 'Blend da Casa · Xarope artesanal de fava de baunilha real',
        description:
          'Espresso suave combinado a leite texturizado e redução própria feita com favas inteiras de baunilha Bourbon.',
        tastingNotes: 'Baunilha floral · Creme brûlée',
        volume: '240 ml',
        price: 23.00,
      },
    ],
  },
  {
    slug: 'brunch-cozinha',
    name: 'Brunch & Cozinha Autoral',
    description: 'Pratos preparados na hora com pães de fermentação natural, ovos caipiras orgânicos e queijos artesanais.',
    items: [
      {
        name: 'Eggs Benedict no Brioche Tostado',
        origin: 'Ovos caipiras pochê · Presunto Royale artesanal · Hollandaise cítrico',
        description:
          'Brioche de fermentação lenta dourado na manteiga clarificada, dois ovos pochê de gema cremosa e molho hollandaise com toque de limão-cravo.',
        tastingNotes: 'Amanteigado · Gema aveludada · Acidez delicada',
        volume: '260 g',
        price: 42.00,
        isSignature: true,
      },
      {
        name: 'Avocado Toast & Ovo Mollet',
        origin: 'Levain 36h · Avocado Hass · Dukkah de pistache',
        description:
          'Fatia alta de pão rústico com avocado laminado, coalhada seca artesanal, ovo mollet de 6 minutos, azeite extravirgem e especiarias tostadas.',
        tastingNotes: 'Pistache tostado · Limão-siciliano · Ervas frescas',
        volume: '240 g',
        price: 38.00,
        isSignature: true,
      },
      {
        name: 'Croque Monsieur ao Gruyère de Caverna',
        origin: 'Pão de miga artesanal · Bechamel com noz-moscada · Queijo meia-cura',
        description:
          'Sanduíche clássico francês gratinado no forno até borbulhar, servido com pequena salada de folhas orgânicas e mostarda Dijon.',
        tastingNotes: 'Queijo gratinado · Noz-moscada · Crocante',
        volume: '250 g',
        price: 39.00,
      },
      {
        name: 'Toast de Ricota Batida, Figos & Mel Nativo',
        origin: 'Pão de campanha · Figos frescos grelhados · Mel de jataí',
        description:
          'Ricota fresca aerada com raspas de laranja, figos caramelizados no maçarico, amêndoas laminadas e fio generoso de mel de abelha nativa.',
        tastingNotes: 'Figo maduro · Mel floral · Castanhas',
        volume: '210 g',
        price: 34.00,
      },
    ],
  },
  {
    slug: 'confeitaria',
    name: 'Viennoiserie & Folhados',
    description: 'Fornadas diárias com manteiga francesa AOC, laminação de 72 horas e chocolates bean-to-bar brasileiros.',
    items: [
      {
        name: 'Croissant de Manteiga de Barratte',
        origin: 'Laminação de 72 horas · Manteiga extra seca 84%',
        description:
          'Casca dourada e estaladiça, alvéolos abertos em favo de mel e interior úmido e perfumado. Servido levemente aquecido.',
        tastingNotes: 'Manteiga noisette · Trigo fermentado',
        volume: '95 g',
        price: 19.00,
        isSignature: true,
      },
      {
        name: 'Pain au Chocolat Amargo 70%',
        origin: 'Cacau orgânico do Sul da Bahia · Duas barras internas',
        description:
          'Massa folhada de longa fermentação recheada com duas barras de chocolate 70% de origem única.',
        tastingNotes: 'Cacau intenso · Manteiga dourada',
        volume: '110 g',
        price: 22.00,
      },
      {
        name: 'Kouign-Amann Caramelizado',
        origin: 'Clássico da Bretanha · Flor de sal de Mossoró',
        description:
          'Folhado bretão dobrado com açúcar demerara orgânico e manteiga com flor de sal, assado até formar uma crosta de caramelo crocante.',
        tastingNotes: 'Caramelo crocante · Flor de sal · Manteiga',
        volume: '105 g',
        price: 23.00,
        isSignature: true,
      },
      {
        name: 'Folhado de Pistache Iraniano & Framboesa',
        origin: 'Frangipane de pistache · Compota artesanal de framboesa',
        description:
          'Massa folhada crocante recheada com creme de pistache tostado na casa e coração ácido de framboesas frescas.',
        tastingNotes: 'Pistache verde · Framboesa ácida',
        volume: '120 g',
        price: 26.00,
      },
    ],
  },
  {
    slug: 'patisserie-fina',
    name: 'Pâtisserie & Tortas Autorais',
    description: 'Confeitaria fina de vitrine pensada para harmonizar com cafés filtrados e espressos.',
    items: [
      {
        name: 'Torta Basca de Queijo da Canastra',
        origin: 'Queijo Canastra meia-cura · Fava Tonka da Amazônia',
        description:
          'Topo intensamente caramelizado e centro cremoso quase líquido, perfumado com cumaru (fava tonka) ralado na hora.',
        tastingNotes: 'Caramelo queimado · Queijo curado · Cumaru',
        volume: '150 g',
        price: 28.00,
        isSignature: true,
      },
      {
        name: 'Entremet Ópera de Café & Avelã',
        origin: 'Biscuit Joconde · Ganache 70% · Mousseline de espresso',
        description:
          'Seis camadas finas intercalando amêndoas embebidas em ristretto, ganache de chocolate amargo e creme leve de avelã do Piemonte.',
        tastingNotes: 'Ristretto · Avelã tostada · Cacau profundo',
        volume: '130 g',
        price: 31.00,
        isSignature: true,
      },
      {
        name: 'Tartelette de Limão-Siciliano & Merengue Tostado',
        origin: 'Pâte sucrée de amêndoas · Curd cítrico · Merengue suíço',
        description:
          'Base crocante de farinha de amêndoas recheada com creme intenso de limão-siciliano e finalizada no maçarico.',
        tastingNotes: 'Cítrico vibrante · Baunilha · Amêndoas',
        volume: '125 g',
        price: 25.00,
      },
      {
        name: 'Éclair de Caramelo Salgado & Praliné',
        origin: 'Massa choux craquelin · Creme diplomata de caramelo',
        description:
          'Éclair crocante recheada na hora com creme leve de caramelo com flor de sal e crocante de castanha-de-caju caramelizada.',
        tastingNotes: 'Caramelo com flor de sal · Castanha tostada',
        volume: '115 g',
        price: 24.00,
      },
    ],
  },
];

// =============================================================
// DRG-Rently — XML Feed Worker
// Gera XML feed dos imóveis publicados de um tenant pra portais imobiliários
// =============================================================
//
// Endpoints:
//   GET /?tenant=<tenantId|slug>                  → XML padrão Wimoveis
//   GET /?tenant=<tenantId|slug>&format=wimoveis  → XML padrão Wimoveis (Chaves na Mão, regionais)
//   GET /?tenant=<tenantId|slug>&format=zap       → XML padrão Zap (ZAP/Viva)
//   GET /?tenant=<tenantId|slug>&format=olx       → XML padrão OLX (similar Wimoveis)
//   GET /?tenant=<tenantId|slug>&format=imovelweb → XML padrão Imovelweb
//   + &portal=<id>  → só os anúncios marcados para aquele portal (anuncioPortais)
//   GET /compartilhar?t=<tenant>&id=<imovel>     → prévia (og:image/título/preço) + vai pro imóvel
//   GET /compartilhar?t=<tenant>&lista=<id,id>   → prévia da lista de favoritos + vai pra lista
//
// Configuração no Cloudflare Worker:
//   Variables:
//     PROJECT_ID = drg-rently
//   Secrets:
//     FIREBASE_API_KEY = (mesma key do firebase-config.js, é pública por design)
//
// Cache: 10 min (CDN do Cloudflare)
// =============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Prévia com foto para WhatsApp/Facebook/Google (ver paginaCompartilhar)
    if (url.pathname.replace(/\/+$/, '') === '/compartilhar') {
      if (!env.FIREBASE_API_KEY) return new Response('Worker mal configurado', { status: 500 });
      const FS = `https://firestore.googleapis.com/v1/projects/${env.PROJECT_ID || 'drg-rently'}/databases/(default)/documents`;
      try { return await paginaCompartilhar(url, env, FS, env.FIREBASE_API_KEY); }
      catch (e) { return new Response('Erro: ' + e.message, { status: 500 }); }
    }

    const tenantParam = url.searchParams.get('tenant');
    const format = (url.searchParams.get('format') || 'wimoveis').toLowerCase();

    if (!tenantParam) {
      return new Response(htmlHelp(env), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    try {
      const PROJECT_ID = env.PROJECT_ID || 'drg-rently';
      const API_KEY = env.FIREBASE_API_KEY;
      if (!API_KEY) {
        return new Response('Worker mal configurado: FIREBASE_API_KEY não está definido.', { status: 500 });
      }
      const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

      // 1) Resolve slug → tenantId
      let tenantId = tenantParam;
      try {
        const directRes = await fetch(`${FIRESTORE}/tenants/${tenantParam}?key=${API_KEY}`);
        if (!directRes.ok) {
          // Não é ID direto — tenta resolver por slug
          const slugQuery = {
            structuredQuery: {
              from: [{ collectionId: 'tenants' }],
              where: {
                fieldFilter: {
                  field: { fieldPath: 'slug' },
                  op: 'EQUAL',
                  value: { stringValue: tenantParam },
                },
              },
              limit: 1,
            },
          };
          const slugRes = await fetch(`${FIRESTORE}:runQuery?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(slugQuery),
          });
          const slugData = await slugRes.json();
          const slugDoc = (slugData || []).map(r => r.document).filter(Boolean)[0];
          if (!slugDoc) {
            return new Response(`Tenant não encontrado: ${tenantParam}`, { status: 404 });
          }
          tenantId = slugDoc.name.split('/').pop();
        }
      } catch (e) {
        return new Response('Erro resolvendo tenant: ' + e.message, { status: 500 });
      }

      // 2) Busca o tenant
      const tRes = await fetch(`${FIRESTORE}/tenants/${tenantId}?key=${API_KEY}`);
      if (!tRes.ok) {
        return new Response(`Tenant não encontrado: ${tenantId}`, { status: 404 });
      }
      const tenant = parseFirestoreDoc(await tRes.json());

      // 3) Lista imóveis publicados (coleção vitrine — só campos públicos)
      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: 'vitrine' }], // cópia pública (sem dados internos) — ver rede.js
          where: {
            fieldFilter: {
              field: { fieldPath: 'linkPublico' },
              op: 'EQUAL',
              value: { booleanValue: true },
            },
          },
          limit: 500,
        },
      };
      const qRes = await fetch(`${FIRESTORE}/tenants/${tenantId}:runQuery?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queryBody),
      });
      if (!qRes.ok) {
        return new Response('Erro listando imóveis: ' + qRes.status, { status: 500 });
      }
      const qData = await qRes.json();
      const docs = (qData || []).map(r => r.document).filter(Boolean);
      let imoveis = docs.map(parseFirestoreDoc);

      // Filtra: só os com vitrineFeed !== false (default true)
      imoveis = imoveis.filter(im => im.vitrineFeed !== false);

      // Portais escolhidos no anúncio (anuncioPortais = { portalId: nivel }).
      // Sem o mapa = anúncio antigo, vai para todos (comportamento de sempre).
      // Com ?portal= na URL, só entra quem foi marcado para aquele portal.
      const portalParam = (url.searchParams.get('portal') || '').toLowerCase();
      const temMapa = im => im.anuncioPortais && typeof im.anuncioPortais === 'object';
      if (portalParam) {
        imoveis = imoveis.filter(im => !temMapa(im) || im.anuncioPortais[portalParam] != null);
      }
      imoveis.forEach(im => {
        im._titulo = im.tituloAnuncio || im.apelido || '';
        let desc = im.descricaoLonga || im._titulo;
        // Permuta não tem campo padrão nos XMLs dos portais: vai no texto
        if (im.aceitaPermuta === 'sim' && (im.finalidade || 'locacao') !== 'locacao' && !/permuta/i.test(desc)) {
          desc += `\n\nAceita permuta${im.permutaObs ? `: ${im.permutaObs}` : '.'}`;
        }
        im._descricao = im.codigoAnuncio ? `${desc}\n\nCódigo do anúncio: ${im.codigoAnuncio}` : desc;
        const nivel = temMapa(im)
          ? (im.anuncioPortais[portalParam] || im.anuncioPortais.zap || im.anuncioPortais.vivareal || null)
          : null;
        im._publicacaoZap = NIVEL_ZAP[nivel] || null;
      });

      // 4) Carrega fotos em paralelo (máx 30 por imóvel)
      await Promise.all(imoveis.map(async (im) => {
        try {
          const fRes = await fetch(`${FIRESTORE}/tenants/${tenantId}/imoveis/${im.id}/fotos?key=${API_KEY}&pageSize=30&orderBy=ordem`);
          if (fRes.ok) {
            const fJson = await fRes.json();
            im.fotos = (fJson.documents || []).map(parseFirestoreDoc).filter(f => f && f.url);
          } else {
            im.fotos = [];
          }
        } catch (_) {
          im.fotos = [];
        }
      }));

      // 5) Gera XML conforme formato
      let xml;
      switch (format) {
        case 'zap':
        case 'vivareal':
          xml = gerarZapXml(tenant, imoveis); break;
        case 'olx':
          xml = gerarOlxXml(tenant, imoveis); break;
        case 'imovelweb':
          xml = gerarImovelwebXml(tenant, imoveis); break;
        case 'facebook':
        case 'meta':
        case 'instagram': {
          const site = (env.SITE_URL || 'https://zett-romao.github.io/drg-rently/').replace(/\/?$/, '/');
          xml = gerarFacebookXml(tenant, imoveis, site, tenant?.slug || tenantId); break;
        }
        case 'wimoveis':
        case 'chavesnamao':
        default:
          xml = gerarWimoveisXml(tenant, imoveis); break;
      }

      return new Response(xml, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=600',  // 10 min na borda
          'Access-Control-Allow-Origin': '*',
          'X-Tenant': tenantId,
          'X-Format': format,
          'X-Imoveis-Count': String(imoveis.length),
        },
      });
    } catch (err) {
      return new Response('Erro interno: ' + err.message, { status: 500 });
    }
  },
};

// =============================================================
// Helpers de parsing Firestore REST → JS object
// =============================================================

function parseFirestoreDoc(doc) {
  if (!doc) return null;
  const obj = { id: (doc.name || '').split('/').pop() };
  for (const [k, v] of Object.entries(doc.fields || {})) {
    obj[k] = parseFirestoreValue(v);
  }
  return obj;
}

function parseFirestoreValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return parseFloat(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) {
    const m = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) m[k] = parseFirestoreValue(vv);
    return m;
  }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(parseFirestoreValue);
  if ('geoPointValue' in v) return v.geoPointValue;
  return null;
}

// =============================================================
// XML escaping
// =============================================================

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cdata(s) {
  if (s == null) return '';
  return `<![CDATA[${String(s).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

// =============================================================
// Geradores de XML por formato
// =============================================================

function tenantInfo(tenant) {
  return {
    nome: tenant?.nome || 'DRG-Rently',
    email: tenant?.emailContato || '',
    telefone: tenant?.telefone || '',
    creci: tenant?.creci || '',
  };
}

// Nível de relevância do anúncio → PublicationType do VRSync (ZAP/Viva Real).
// O portal só honra o nível se o plano contratado tiver cota; sem cota, rebaixa.
const NIVEL_ZAP = {
  padrao: 'STANDARD',
  destaque: 'PREMIUM',
  super: 'SUPER_PREMIUM',
  premium: 'PREMIERE_1',
};

function finalidadeLabel(im) {
  const f = im.finalidade || 'locacao';
  if (f === 'venda') return 'Venda';
  if (f === 'ambos') return 'Venda/Locação';
  return 'Locação';
}

// --- WIMOVEIS (Chaves na Mão, regionais, base genérica) ---
function gerarWimoveisXml(tenant, imoveis) {
  const t = tenantInfo(tenant);
  const items = imoveis.map(im => {
    const end = im.endereco || {};
    const fotos = (im.fotos || []).slice(0, 30).map((f, i) =>
      `      <Foto>
        <NomeArquivo>${esc('foto_' + (i + 1) + '.jpg')}</NomeArquivo>
        <URLArquivo>${esc(f.url)}</URLArquivo>
        <Principal>${i === 0 ? '1' : '0'}</Principal>
      </Foto>`).join('\n');

    return `  <Imovel>
    <CodigoImovel>${esc(im.id)}</CodigoImovel>
    <TituloImovel>${cdata(im._titulo)}</TituloImovel>
    <TipoOferta>${finalidadeLabel(im)}</TipoOferta>
    <SubTipoImovel>${esc(im.subtipo || im.tipo || 'Outros')}</SubTipoImovel>
    <CategoriaImovel>${esc(im.tipo === 'comercial' ? 'Comercial' : 'Residencial')}</CategoriaImovel>
    <CEP>${esc(end.cep)}</CEP>
    <Endereco>${esc(end.logradouro)}</Endereco>
    <Numero>${esc(end.numero)}</Numero>
    <Complemento>${esc(end.complemento)}</Complemento>
    <Bairro>${esc(end.bairro)}</Bairro>
    <Cidade>${esc(end.cidade)}</Cidade>
    <UF>${esc(end.uf)}</UF>
    <AreaUtil>${im.areaUtil || ''}</AreaUtil>
    <AreaTotal>${im.areaTotal || ''}</AreaTotal>
    <QtdDormitorios>${im.quartos || 0}</QtdDormitorios>
    <QtdBanheiros>${im.banheiros || 0}</QtdBanheiros>
    <QtdVagas>${im.vagas || 0}</QtdVagas>
    <Andar>${esc(im.andar)}</Andar>
    <Mobiliado>${im.mobiliado === 'sim' ? 'Sim' : im.mobiliado === 'parcial' ? 'Parcial' : 'Não'}</Mobiliado>
    <PrecoVenda>${im.valorVenda || 0}</PrecoVenda>
    <PrecoLocacao>${im.aluguelSugerido || 0}</PrecoLocacao>
    <PrecoCondominio>${im.valorCondominio || 0}</PrecoCondominio>
    <PrecoIPTU>${im.valorIPTU || 0}</PrecoIPTU>
    <Observacao>${cdata(im._descricao)}</Observacao>
    <UrlVideo>${esc(im.videoUrl)}</UrlVideo>
    <UrlTour360>${esc(im.tourUrl)}</UrlTour360>
    <Fotos>
${fotos}
    </Fotos>
  </Imovel>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Carga>
  <Imobiliaria>
    <NomeImobiliaria>${esc(t.nome)}</NomeImobiliaria>
    <CRECI>${esc(t.creci)}</CRECI>
    <Email>${esc(t.email)}</Email>
    <Telefone>${esc(t.telefone)}</Telefone>
  </Imobiliaria>
  <Imoveis>
${items}
  </Imoveis>
</Carga>`;
}

// --- ZAP / VIVA REAL (ListingDataFeed) ---
function gerarZapXml(tenant, imoveis) {
  const t = tenantInfo(tenant);
  const listings = imoveis.map(im => {
    const end = im.endereco || {};
    const isVenda = im.finalidade === 'venda' || im.finalidade === 'ambos';
    const isLocacao = im.finalidade === 'locacao' || im.finalidade === 'ambos';
    const txTypes = [];
    if (isVenda) txTypes.push('<TransactionType>For Sale</TransactionType>');
    if (isLocacao) txTypes.push('<TransactionType>For Rent</TransactionType>');

    const media = (im.fotos || []).slice(0, 30).map((f, i) =>
      `        <Item caption="${esc(im._titulo || 'Foto')}" medium="image" primary="${i === 0 ? 'true' : 'false'}">${esc(f.url)}</Item>`
    ).join('\n');

    const tipoMap = {
      apartamento: 'Apartment',
      casa: 'Home',
      sobrado: 'Home',
      kitnet: 'Apartment',
      sala: 'Commercial Building',
      loja: 'Commercial Building',
      galpao: 'Commercial Building',
      terreno: 'Residential Allotment Land',
    };
    const propertyType = tipoMap[im.subtipo] || (im.tipo === 'comercial' ? 'Commercial Building' : 'Home');

    return `    <Listing>
      <ListingID>${esc(im.id)}</ListingID>
      <Title>${cdata(im._titulo)}</Title>
      <TransactionTypes>${txTypes.join('')}</TransactionTypes>
      ${im._publicacaoZap ? `<PublicationType>${im._publicacaoZap}</PublicationType>` : ''}
      <Details>
        <PropertyType>${esc(propertyType)}</PropertyType>
        <Description>${cdata(im._descricao)}</Description>
        <LivingArea unit="square metres">${im.areaUtil || 0}</LivingArea>
        <LotArea unit="square metres">${im.areaTotal || 0}</LotArea>
        <Bedrooms>${im.quartos || 0}</Bedrooms>
        <Bathrooms>${im.banheiros || 0}</Bathrooms>
        <Garage type="Parking Space">${im.vagas || 0}</Garage>
        ${isVenda ? `<ListPrice currency="BRL">${im.valorVenda || 0}</ListPrice>` : ''}
        ${isLocacao ? `<RentalPrice currency="BRL" period="Monthly">${im.aluguelSugerido || 0}</RentalPrice>` : ''}
        <YearlyTax currency="BRL">${(im.valorIPTU || 0) * 12}</YearlyTax>
        <PropertyAdministrationFee currency="BRL">${im.valorCondominio || 0}</PropertyAdministrationFee>
        <Media>
${media}
${im.videoUrl ? `          <Item medium="video">${esc(im.videoUrl)}</Item>` : ''}
${im.tourUrl ? `          <Item medium="tour">${esc(im.tourUrl)}</Item>` : ''}
        </Media>
      </Details>
      <Location displayAddress="Neighborhood">
        <Country abbreviation="BR">Brasil</Country>
        <State abbreviation="${esc(end.uf || '')}">${esc(end.uf || '')}</State>
        <City>${esc(end.cidade || '')}</City>
        <Neighborhood>${esc(end.bairro || '')}</Neighborhood>
        <Address>${esc(end.logradouro || '')}</Address>
        <StreetNumber>${esc(end.numero || '')}</StreetNumber>
        <PostalCode>${esc(end.cep || '')}</PostalCode>
      </Location>
      <ContactInfo>
        <Name>${esc(t.nome)}</Name>
        <Email>${esc(t.email)}</Email>
        <Telephone>${esc(t.telefone)}</Telephone>
      </ContactInfo>
    </Listing>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListingDataFeed xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.vivareal.com/schemas/1.0/VRSync.xsd">
  <Header>
    <Provider>${esc(t.nome)}</Provider>
    <Email>${esc(t.email)}</Email>
    <ContactName>${esc(t.nome)}</ContactName>
    <PublishDate>${new Date().toISOString()}</PublishDate>
  </Header>
  <Listings>
${listings}
  </Listings>
</ListingDataFeed>`;
}

// --- OLX (similar Wimoveis, padrão OLX) ---
function gerarOlxXml(tenant, imoveis) {
  const t = tenantInfo(tenant);
  const items = imoveis.map(im => {
    const end = im.endereco || {};
    const fotos = (im.fotos || []).slice(0, 20).map(f =>
      `      <imagem>${esc(f.url)}</imagem>`).join('\n');

    return `  <ad>
    <id>${esc(im.id)}</id>
    <category>${im.tipo === 'comercial' ? 'Comerciais' : 'Imóveis'}</category>
    <subject>${cdata(im._titulo)}</subject>
    <body>${cdata(im._descricao)}</body>
    <type>${esc(im.subtipo || 'Outros')}</type>
    <transactionType>${finalidadeLabel(im)}</transactionType>
    <price>${im.aluguelSugerido || im.valorVenda || 0}</price>
    <iptu>${im.valorIPTU || 0}</iptu>
    <condominio>${im.valorCondominio || 0}</condominio>
    <usableAreas>${im.areaUtil || 0}</usableAreas>
    <totalAreas>${im.areaTotal || 0}</totalAreas>
    <bedrooms>${im.quartos || 0}</bedrooms>
    <bathrooms>${im.banheiros || 0}</bathrooms>
    <garages>${im.vagas || 0}</garages>
    <zipCode>${esc(end.cep)}</zipCode>
    <city>${esc(end.cidade)}</city>
    <state>${esc(end.uf)}</state>
    <neighborhood>${esc(end.bairro)}</neighborhood>
    <address>${esc(end.logradouro)}</address>
    <addressNumber>${esc(end.numero)}</addressNumber>
    <images>
${fotos}
    </images>
    ${im.videoUrl ? `<videoUrl>${esc(im.videoUrl)}</videoUrl>` : ''}
  </ad>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ads>
${items}
</ads>`;
}

// --- IMOVELWEB ---
function gerarImovelwebXml(tenant, imoveis) {
  const t = tenantInfo(tenant);
  const items = imoveis.map(im => {
    const end = im.endereco || {};
    const fotos = (im.fotos || []).slice(0, 30).map((f, i) =>
      `      <foto orden="${i + 1}">${esc(f.url)}</foto>`).join('\n');

    return `  <propiedad>
    <referencia>${esc(im.id)}</referencia>
    <titulo>${cdata(im._titulo)}</titulo>
    <descripcion>${cdata(im._descricao)}</descripcion>
    <tipo_inmueble>${esc(im.subtipo || 'Casa')}</tipo_inmueble>
    <operacion>${finalidadeLabel(im)}</operacion>
    <pais>Brasil</pais>
    <provincia>${esc(end.uf)}</provincia>
    <ciudad>${esc(end.cidade)}</ciudad>
    <barrio>${esc(end.bairro)}</barrio>
    <direccion>${esc(end.logradouro)} ${esc(end.numero)}</direccion>
    <codigo_postal>${esc(end.cep)}</codigo_postal>
    <superficie_util>${im.areaUtil || 0}</superficie_util>
    <superficie_total>${im.areaTotal || 0}</superficie_total>
    <dormitorios>${im.quartos || 0}</dormitorios>
    <banos>${im.banheiros || 0}</banos>
    <garages>${im.vagas || 0}</garages>
    <precio>${im.valorVenda || im.aluguelSugerido || 0}</precio>
    <moneda>BRL</moneda>
    <expensas>${im.valorCondominio || 0}</expensas>
    <fotos>
${fotos}
    </fotos>
    ${im.videoUrl ? `<video>${esc(im.videoUrl)}</video>` : ''}
  </propiedad>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<propiedades inmobiliaria="${esc(t.nome)}" telefono="${esc(t.telefone)}" email="${esc(t.email)}">
${items}
</propiedades>`;
}

// --- FACEBOOK / INSTAGRAM (catálogo de imóveis da Meta — Home Listing) ---
// Obrigatórios pela Meta: id, nome, disponibilidade, endereço (cidade, estado,
// país, CEP), latitude/longitude, preço "valor MOEDA", imagem e link.
// Lat/long vêm de vitrine.geo (aproximada pelo CEP — ver rede.js). Imóvel sem
// geo, sem foto ou sem preço é pulado (a Meta rejeitaria). "Ambos" vira 2 anúncios.
const UF_NOME = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
  MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará',
  PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

function gerarFacebookXml(tenant, imoveis, site, tenantRef) {
  const listings = [];
  imoveis.forEach(im => {
    const end = im.endereco || {};
    const geo = im.geo || {};
    const fotos = (im.fotos || []).slice(0, 20);
    if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lng) || fotos.length === 0) return;
    if (!end.cidade || !end.uf || !end.cep) return;

    const ofertas = [];
    const fin = im.finalidade || 'locacao';
    if (fin !== 'venda' && im.aluguelSugerido) ofertas.push({ sufixo: fin === 'ambos' ? '-aluguel' : '', disp: 'for_rent', preco: im.aluguelSugerido });
    if (fin !== 'locacao' && im.valorVenda) ofertas.push({ sufixo: fin === 'ambos' ? '-venda' : '', disp: 'for_sale', preco: im.valorVenda });

    const link = `${site}imovel.html?id=${encodeURIComponent(im.id)}&t=${encodeURIComponent(tenantRef)}`;
    const nome = im._titulo || [end.bairro, end.cidade].filter(Boolean).join(', ') || 'Imóvel';
    const imagens = fotos.map(f => `      <image><url>${esc(f.url)}</url></image>`).join('\n');

    ofertas.forEach(o => {
      listings.push(`  <listing>
    <home_listing_id>${esc(im.id + o.sufixo)}</home_listing_id>
    <name>${cdata(nome)}</name>
    <availability>${o.disp}</availability>
    <description>${cdata(im._descricao || nome)}</description>
    <address format="simple">
      <component name="addr1">${esc(end.logradouro || end.bairro || end.cidade)}</component>
      <component name="city">${esc(end.cidade)}</component>
      <component name="region">${esc(UF_NOME[String(end.uf).toUpperCase()] || end.uf)}</component>
      <component name="country">Brazil</component>
      <component name="postal_code">${esc(String(end.cep).replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2'))}</component>
    </address>
    ${end.bairro ? `<neighborhood>${esc(end.bairro)}</neighborhood>` : ''}
    <latitude>${geo.lat}</latitude>
    <longitude>${geo.lng}</longitude>
${imagens}
    <price>${Math.round(o.preco)} BRL</price>
    <url>${esc(link)}</url>
    ${im.quartos ? `<num_beds>${im.quartos}</num_beds>` : ''}
    ${im.banheiros ? `<num_baths>${im.banheiros}</num_baths>` : ''}
    ${im.areaUtil ? `<area_size>${im.areaUtil}</area_size><area_unit>sq_m</area_unit>` : ''}
    <property_type>${esc({ apartamento: 'apartment', casa: 'house', sobrado: 'townhouse', kitnet: 'apartment', terreno: 'land' }[im.subtipo] || (im.tipo === 'comercial' ? 'other' : 'house'))}</property_type>
  </listing>`);
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<listings>
  <title>${esc(tenantInfo(tenant).nome)}</title>
${listings.join('\n')}
</listings>`;
}

// =============================================================
// Página de ajuda quando acessa sem ?tenant=
// =============================================================
// =============================================================
// /compartilhar — prévia do link no WhatsApp/Facebook/Google
// As páginas do site montam título e foto via JavaScript, que o WhatsApp
// não executa: o link mostrava só "Imóvel disponível". Aqui o HTML já sai
// com og:title/og:image/og:description do imóvel e redireciona o visitante.
// O destino é sempre o SITE_URL (nunca vem da URL: sem redirecionamento aberto).
// =============================================================
const ID_OK = /^[A-Za-z0-9_-]{1,80}$/;

async function resolverTenantId(param, FIRESTORE, KEY) {
  if (!ID_OK.test(param || '')) return null;
  const direto = await fetch(`${FIRESTORE}/tenants/${param}?key=${KEY}`);
  if (direto.ok) return param;
  const q = await fetch(`${FIRESTORE}:runQuery?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'tenants' }],
      where: { fieldFilter: { field: { fieldPath: 'slug' }, op: 'EQUAL', value: { stringValue: param } } }, limit: 1 } }),
  });
  const doc = ((await q.json()) || []).map(r => r.document).filter(Boolean)[0];
  return doc ? doc.name.split('/').pop() : null;
}

function precoTexto(im) {
  const brl = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if ((im.publicacao || {}).mostrarValor === false) return 'Valor sob consulta';
  const f = im.finalidade || 'locacao';
  if (f !== 'locacao' && im.valorVenda) return brl(im.valorVenda) + (f === 'ambos' && im.aluguelSugerido ? ` · aluguel ${brl(im.aluguelSugerido)}/mês` : '');
  if (im.aluguelSugerido) return `${brl(im.aluguelSugerido)}/mês`;
  return '';
}

async function paginaCompartilhar(url, env, FIRESTORE, KEY) {
  const site = (env.SITE_URL || 'https://zett-romao.github.io/drg-rently/').replace(/\/?$/, '/');
  const t = url.searchParams.get('t') || '';
  const id = url.searchParams.get('id') || '';
  const lista = (url.searchParams.get('lista') || '').split(',').map(x => x.trim()).filter(x => ID_OK.test(x)).slice(0, 60);
  if (!ID_OK.test(t) || (id && !ID_OK.test(id))) return new Response('Link inválido', { status: 400 });

  const enc = encodeURIComponent;
  const destino = id
    ? `${site}imovel.html?id=${enc(id)}&t=${enc(t)}`
    : `${site}imoveis.html?t=${enc(t)}${lista.length ? `&lista=${lista.map(enc).join(',')}` : ''}`;

  let titulo = 'Imóveis disponíveis', descricao = 'Confira os imóveis disponíveis.', imagem = `${site}logo.png`;
  try {
    const tenantId = await resolverTenantId(t, FIRESTORE, KEY);
    if (tenantId) {
      const tRes = await fetch(`${FIRESTORE}/tenants/${tenantId}?key=${KEY}`);
      const tenant = tRes.ok ? parseFirestoreDoc(await tRes.json()) : {};
      const nome = tenant.nome || 'Imobiliária';
      if (tenant.logoUrl) imagem = tenant.logoUrl;
      titulo = `${nome} — Imóveis disponíveis`; // vale se o imóvel/lista não for achado
      const lerVitrine = async (vid) => {
        const r = await fetch(`${FIRESTORE}/tenants/${tenantId}/vitrine/${vid}?key=${KEY}`);
        return r.ok ? parseFirestoreDoc(await r.json()) : null;
      };
      if (id) {
        const im = await lerVitrine(id);
        if (im && im.linkPublico === true) {
          const end = im.endereco || {};
          titulo = `${im.tituloAnuncio || im.apelido || 'Imóvel'} — ${nome}`;
          const pub = im.publicacao || {};
          const partes = [
            precoTexto(im),
            pub.mostrarComodos !== false && im.quartos ? `${im.quartos} quarto${im.quartos > 1 ? 's' : ''}` : '',
            pub.mostrarArea !== false && im.areaUtil ? `${im.areaUtil} m²` : '',
            [end.bairro, end.cidade].filter(Boolean).join(', '),
            im.codigoAnuncio ? `Cód. ${im.codigoAnuncio}` : '',
          ].filter(Boolean);
          descricao = partes.join(' · ');
          if (im.coverUrl) imagem = im.coverUrl;
        }
      } else if (lista.length) {
        const primeiros = (await Promise.all(lista.slice(0, 4).map(lerVitrine))).filter(x => x && x.linkPublico === true);
        titulo = `${lista.length} imóve${lista.length > 1 ? 'is separados' : 'l separado'} para você — ${nome}`;
        descricao = primeiros.map(x => x.tituloAnuncio || x.apelido).filter(Boolean).slice(0, 3).join(' · ') || descricao;
        const comFoto = primeiros.find(x => x.coverUrl);
        if (comFoto) imagem = comFoto.coverUrl;
      } else {
        titulo = `${nome} — Imóveis disponíveis`;
      }
    }
  } catch (_) { /* sem prévia rica: ainda redireciona */ }

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descricao)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descricao)}">
<meta property="og:image" content="${esc(imagem)}">
<meta property="og:url" content="${esc(destino)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${esc(destino)}">
<meta http-equiv="refresh" content="0;url=${esc(destino)}">
</head><body style="font-family:sans-serif;text-align:center;padding:40px">
<p>Abrindo… <a href="${esc(destino)}">toque aqui se não abrir</a></p>
<script>location.replace(${JSON.stringify(destino)})</script>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}

function htmlHelp() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>DRG-Rently Feed Worker</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1e293b; line-height: 1.6; }
    h1 { color: #475569; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    .ok { color: #16a34a; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { padding: 8px; border: 1px solid #cbd5e1; text-align: left; font-size: 14px; }
    th { background: #f1f5f9; }
  </style>
</head>
<body>
  <h1>📡 DRG-Rently — Feed XML para Portais</h1>
  <p class="ok">✅ Worker está rodando.</p>
  <p>Este endpoint gera o XML feed de imóveis publicados para os portais imobiliários.</p>

  <h2>Como usar</h2>
  <p>Passe o ID ou slug do tenant na query string:</p>
  <p><code>/?tenant=&lt;tenantId-ou-slug&gt;&format=&lt;wimoveis|zap|olx|imovelweb&gt;</code></p>

  <h2>Formatos disponíveis</h2>
  <table>
    <tr><th>Formato</th><th>Portais que aceitam</th><th>URL de exemplo</th></tr>
    <tr><td><code>wimoveis</code> (default)</td><td>Chaves na Mão, DF Imóveis, SP Imóvel, regionais</td><td><code>?tenant=xxx</code></td></tr>
    <tr><td><code>zap</code></td><td>ZAP Imóveis, Viva Real</td><td><code>?tenant=xxx&format=zap</code></td></tr>
    <tr><td><code>olx</code></td><td>OLX Imóveis</td><td><code>?tenant=xxx&format=olx</code></td></tr>
    <tr><td><code>imovelweb</code></td><td>Imovelweb</td><td><code>?tenant=xxx&format=imovelweb</code></td></tr>
    <tr><td><code>facebook</code></td><td>Facebook / Instagram (catálogo Meta)</td><td><code>?tenant=xxx&format=facebook</code></td></tr>
  </table>

  <h2>Cache</h2>
  <p>Resposta cacheada por 10 minutos na CDN do Cloudflare. Pra forçar atualização imediata, troque o tenant ou aguarde o TTL.</p>

  <h2>Filtros aplicados</h2>
  <ul>
    <li>Apenas imóveis com <code>linkPublico === true</code> (publicados)</li>
    <li>Apenas imóveis com <code>vitrineFeed !== false</code> (toggle do anunciante)</li>
    <li>Máximo 500 imóveis por tenant, 30 fotos por imóvel</li>
  </ul>

  <p style="margin-top: 40px; font-size: 12px; color: #64748b;">
    DRG-Rently · D.R. Global Multi Services
  </p>
</body>
</html>`;
}

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

      // 3) Lista imóveis publicados (linkPublico === true)
      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: 'imoveis' }],
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
    <TituloImovel>${cdata(im.apelido || '')}</TituloImovel>
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
    <Observacao>${cdata(im.descricaoLonga || im.obs || im.apelido || '')}</Observacao>
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
      `        <Item caption="${esc(im.apelido || 'Foto')}" medium="image" primary="${i === 0 ? 'true' : 'false'}">${esc(f.url)}</Item>`
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
      <Title>${cdata(im.apelido || '')}</Title>
      <TransactionTypes>${txTypes.join('')}</TransactionTypes>
      <Details>
        <PropertyType>${esc(propertyType)}</PropertyType>
        <Description>${cdata(im.descricaoLonga || im.obs || im.apelido || '')}</Description>
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
    <subject>${cdata(im.apelido || '')}</subject>
    <body>${cdata(im.descricaoLonga || im.obs || im.apelido || '')}</body>
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
    <titulo>${cdata(im.apelido || '')}</titulo>
    <descripcion>${cdata(im.descricaoLonga || im.obs || im.apelido || '')}</descripcion>
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

// =============================================================
// Página de ajuda quando acessa sem ?tenant=
// =============================================================
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

import { useEffect, useRef, useState } from 'preact/hooks';
import { Camera, FileText, FolderLock, ImagePlus, Lock, Pencil, Plus, Share2, ShieldAlert, Trash2, Undo2, Link2, CalendarClock, Receipt, EyeOff, Check } from 'lucide-preact';
import { data, uid, nowStamp } from '../db/store';
import { alive, catName, categoriesOf, deleteDoc, expiryDeadlineOf, findDoc, linkDoc, linksOfDoc, saveDoc } from '../db/actions';
import { canvasToBlob, fileURL, fmtSize, getFile, loadBitmap, saveFile, shareOrDownload } from '../db/files';
import type { Country, Doc } from '../db/schema';
import { Chips, DateInput, Empty, Field, Money, SearchBox, SensitiveWarning, Seg, SheetBody, TopBar } from '../ui/kit';
import { diffDays, fmtDate, today, type ISODate } from '../lib/dates';
import { maskSensitive } from '../lib/sensitive';
import { normalize } from '../lib/categorize';
import { go, goBack, openSheet } from '../ui/router';
import { toast } from '../ui/feedback';
import { needsDocsUnlock } from '../services/lock';
import { openLockOverlay } from './lock';
import { openTx } from './tx';

export const COUNTRY_LABEL: Record<Country, string> = { CH: 'Suisse', MA: 'Maroc', both: 'Suisse et Maroc' };

function useFileURL(fileId?: string, thumb = false) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (fileId) fileURL(fileId, thumb).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [fileId, thumb]);
  return url;
}

function ExpiryPill({ date }: { date?: ISODate }) {
  if (!date) return null;
  const n = diffDays(today(), date);
  if (n < 0) return <span class="pill red">Expiré</span>;
  if (n <= 60) return <span class="pill yellow">Expire dans {n} j</span>;
  return null;
}

function Tile({ d }: { d: Doc }) {
  const url = useFileURL(d.fileId, true);
  const isPdf = d.mime === 'application/pdf';
  return (
    <button class="doc-tile" onClick={() => go(`/documents/${d.id}`)}>
      <div class="pv">{url ? <img src={url} alt="" /> : isPdf ? <FileText size={30} /> : d.fileId ? <FileText size={30} /> : <FolderLock size={30} />}</div>
      <div class="tx">
        <div class="t">{d.title}</div>
        <div class="tiny muted" style={{ marginTop: 3 }}>
          {catName(d.categoryId)} · {d.country === 'both' ? 'CH + MA' : d.country}
        </div>
        <div style={{ marginTop: 4 }}>
          <ExpiryPill date={d.expiryDate} />
        </div>
      </div>
    </button>
  );
}

export function docMatches(d: Doc, q: string) {
  if (!q) return true;
  const hay = normalize(`${d.title} ${d.note ?? ''} ${d.keywords ?? ''} ${catName(d.categoryId)}`);
  return normalize(q)
    .split(' ')
    .every((w) => hay.includes(w));
}

function LockedDocs() {
  return (
    <Empty icon={<Lock size={26} />} title="Coffre verrouillé" text="Saisissez votre code pour accéder à vos documents.">
      <button class="btn primary" onClick={() => openLockOverlay()}>
        Déverrouiller
      </button>
    </Empty>
  );
}

export function DocumentsScreen() {
  const [q, setQ] = useState('');
  const [country, setCountry] = useState<Country | 'all'>('all');
  const [cat, setCat] = useState<string>('all');
  if (needsDocsUnlock()) {
    return (
      <>
        <TopBar title="Documents" />
        <LockedDocs />
      </>
    );
  }
  const all = alive(data.value.docs);
  const cats = categoriesOf('doc');
  const list = all
    .filter((d) => (country === 'all' ? true : d.country === country || d.country === 'both') && (cat === 'all' || d.categoryId === cat) && docMatches(d, q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <TopBar title="Documents" sub={`${all.length} dans le coffre`}>
        <button class="icon-btn soft" aria-label="Ajouter un document" onClick={() => openDocForm()}>
          <Plus size={24} />
        </button>
      </TopBar>
      <SearchBox value={q} onChange={setQ} placeholder="Rechercher un document" />
      <div style={{ marginTop: 10 }}>
        <Chips scroll small value={country} onChange={setCountry} options={[{ value: 'all', label: 'Tous pays' }, { value: 'CH', label: 'Suisse' }, { value: 'MA', label: 'Maroc' }, { value: 'both', label: 'Les deux' }]} />
      </div>
      <div style={{ marginTop: 8 }}>
        <Chips scroll small value={cat} onChange={setCat} options={[{ value: 'all', label: 'Toutes catégories' }, ...cats.map((c) => ({ value: c.id, label: c.name }))]} />
      </div>
      <div class="section">
        {list.length ? (
          <div class="doc-grid">
            {list.map((d) => (
              <Tile d={d} key={d.id} />
            ))}
          </div>
        ) : all.length ? (
          <Empty icon={<FileText size={26} />} title="Aucun résultat" text="Aucun document ne correspond à cette recherche ou à ces filtres." />
        ) : (
          <Empty icon={<FolderLock size={26} />} title="Votre coffre est vide" text="Ajoutez une photo, un PDF ou une capture d’écran : contrat, police d’assurance, garantie… Les tickets photographiés depuis le budget apparaîtront aussi ici.">
            <button class="btn primary" onClick={() => openDocForm()}>
              Ajouter un document
            </button>
          </Empty>
        )}
      </div>
      <p class="small muted" style={{ marginTop: 14 }}>
        Les fichiers restent sur ce téléphone. Aucun numéro de compte, de carte, de passeport ou d’AVS ne doit y être conservé.
      </p>
    </>
  );
}

// ---------- Détail ----------

export function DocDetail({ id }: { id: string }) {
  const d = findDoc(id);
  const url = useFileURL(d?.fileId);
  if (needsDocsUnlock()) {
    return (
      <>
        <TopBar title="Document" back={() => goBack('/documents')} />
        <LockedDocs />
      </>
    );
  }
  if (!d || d.deletedAt) {
    return (
      <>
        <TopBar title="Document" back={() => goBack('/documents')} />
        <Empty icon={<FileText size={26} />} title="Introuvable" text="Ce document a été supprimé." />
      </>
    );
  }
  const { txs, deadlines } = linksOfDoc(d.id);
  const exp = expiryDeadlineOf(d.id);
  const isImg = d.mime?.startsWith('image/');
  const isPdf = d.mime === 'application/pdf';
  const share = async () => {
    if (!d.fileId) return;
    const f = await getFile(d.fileId);
    if (!f) return toast('Fichier introuvable sur cet appareil.', { tone: 'error' });
    await shareOrDownload(f.blob, f.name || `${d.title}.${isPdf ? 'pdf' : 'jpg'}`);
  };
  return (
    <>
      <TopBar title={d.title} sub={`${catName(d.categoryId)} · ${COUNTRY_LABEL[d.country]}`} back={() => goBack('/documents')}>
        <button class="icon-btn" aria-label="Modifier" onClick={() => openDocForm(d)}>
          <Pencil size={22} />
        </button>
      </TopBar>
      {d.fileId ? (
        <div class="preview-box">
          {url && isImg && <img src={url} alt={d.title} />}
          {url && isPdf && (
            <object data={url} type="application/pdf" aria-label={d.title}>
              <div style={{ padding: 20, textAlign: 'center' }}>
                <FileText size={34} color="var(--bordeaux)" />
                <p class="small muted">Aperçu PDF non disponible ici. Utilisez « Ouvrir / partager ».</p>
              </div>
            </object>
          )}
          {!url && <div style={{ padding: 30, textAlign: 'center' }} class="muted small">Chargement…</div>}
        </div>
      ) : (
        <div class="card cream flat small">Fiche sans fichier joint (titre, dates et notes uniquement).</div>
      )}
      {d.fileId && (
        <button class="btn block" style={{ marginTop: 10 }} onClick={share}>
          <Share2 size={18} /> Ouvrir / partager / enregistrer
        </button>
      )}
      <div class="card flat" style={{ marginTop: 12 }}>
        <div class="kv">
          <span>Catégorie</span>
          <b>{catName(d.categoryId)}</b>
        </div>
        <div class="kv">
          <span>Pays</span>
          <b>{COUNTRY_LABEL[d.country]}</b>
        </div>
        {d.expiryDate && (
          <div class="kv">
            <span>Expiration</span>
            <b class="num">
              {fmtDate(d.expiryDate)} <ExpiryPill date={d.expiryDate} />
            </b>
          </div>
        )}
        {d.size ? (
          <div class="kv">
            <span>Fichier</span>
            <b>
              {isPdf ? 'PDF' : 'Image'} · {fmtSize(d.size)}
              {d.masked ? ' · masqué' : ''}
            </b>
          </div>
        ) : null}
        <div class="kv">
          <span>Ajouté le</span>
          <b class="num">{fmtDate(d.createdAt.slice(0, 10))}</b>
        </div>
        {d.keywords && (
          <div class="kv">
            <span>Mots-clés</span>
            <b>{d.keywords}</b>
          </div>
        )}
        {d.note && <p class="small" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{d.note}</p>}
      </div>
      {exp && (
        <button class="banner" style={{ marginTop: 10 }} onClick={() => go(`/echeances/${exp.id}`)}>
          <CalendarClock size={20} />
          <span>
            Échéance « Fin de validité » liée : <b class="num">{fmtDate(exp.date)}</b>. Elle est mise à jour si vous changez la date d’expiration.
          </span>
        </button>
      )}

      <div class="section">
        <div class="section-head">
          <h2 style={{ fontSize: 17 }}>Liens</h2>
          <button class="link-btn" onClick={() => openSheet('Lier ce document', (c) => <LinkPicker docId={d.id} close={c} />)}>
            <Link2 size={15} /> Lier
          </button>
        </div>
        {txs.length + deadlines.length === 0 ? (
          <p class="small muted" style={{ margin: 0 }}>Aucune dépense ni échéance liée.</p>
        ) : (
          <div class="list">
            {txs.map((t) => (
              <button class="item" onClick={() => openTx(t.id)}>
                <div class="avatar">
                  <Receipt size={20} />
                </div>
                <div class="main">
                  <div class="title">{t.label}</div>
                  <div class="meta">Dépense · {fmtDate(t.date)}</div>
                </div>
                <Money cents={t.amount} cur={t.currency} />
              </button>
            ))}
            {deadlines.map((x) => (
              <button class="item" onClick={() => go(`/echeances/${x.id}`)}>
                <div class="avatar blue">
                  <CalendarClock size={20} />
                </div>
                <div class="main">
                  <div class="title">{x.title}</div>
                  <div class="meta">Échéance · {fmtDate(x.date)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <div class="section">
        <button
          class="btn block ghost"
          style={{ color: 'var(--danger)' }}
          onClick={async () => {
            if (await deleteDoc(d)) go('/documents');
          }}
        >
          <Trash2 size={18} /> Supprimer le document
        </button>
      </div>
    </>
  );
}

// ---------- Masquage des numéros sur une image ----------

function MaskEditor({ file, onDone, close }: { file: Blob; onDone: (b: Blob) => void; close: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rects, setRects] = useState<Array<[number, number, number, number]>>([]);
  const [img, setImg] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [cur, setCur] = useState<[number, number, number, number] | null>(null);

  useEffect(() => {
    loadBitmap(file).then(setImg).catch(() => toast('Image illisible.', { tone: 'error' }));
  }, [file]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;
    const w = 'naturalWidth' in img ? img.naturalWidth : img.width;
    const h = 'naturalHeight' in img ? img.naturalHeight : img.height;
    const scale = Math.min(1, 2000 / Math.max(w, h));
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img as CanvasImageSource, 0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    for (const r of [...rects, ...(cur ? [cur] : [])]) ctx.fillRect(r[0], r[1], r[2], r[3]);
  }, [img, rects, cur]);

  const pos = (e: PointerEvent) => {
    const c = canvasRef.current!;
    const b = c.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * c.width, y: ((e.clientY - b.top) / b.height) * c.height };
  };
  const norm = (a: { x: number; y: number }, b: { x: number; y: number }): [number, number, number, number] => [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y)];

  return (
    <SheetBody
      foot={
        <>
          <button class="btn" disabled={!rects.length} onClick={() => setRects(rects.slice(0, -1))}>
            <Undo2 size={18} /> Annuler
          </button>
          <button
            class="btn primary"
            disabled={!rects.length}
            onClick={async () => {
              const b = await canvasToBlob(canvasRef.current!, 'image/jpeg', 0.88);
              onDone(b);
              close();
            }}
          >
            <Check size={18} /> Valider
          </button>
        </>
      }
    >
      <p class="small" style={{ marginTop: 0 }}>
        Glissez le doigt sur chaque numéro (compte, carte, passeport, AVS…) pour le recouvrir d’un rectangle noir. Seule la version masquée sera enregistrée.
      </p>
      <canvas
        ref={canvasRef}
        class="mask-canvas"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = pos(e);
        }}
        onPointerMove={(e) => {
          if (drag.current) setCur(norm(drag.current, pos(e)));
        }}
        onPointerUp={(e) => {
          if (drag.current) {
            const r = norm(drag.current, pos(e));
            if (r[2] > 6 && r[3] > 6) setRects([...rects, r]);
          }
          drag.current = null;
          setCur(null);
        }}
      />
      <p class="tiny muted">L’application ne détecte pas automatiquement les numéros sur une image : vérifiez attentivement.</p>
    </SheetBody>
  );
}

// ---------- Formulaire ----------

function DocForm({ initial, close, presetFile }: { initial?: Doc; close: () => void; presetFile?: File }) {
  const isNew = !initial;
  const cats = categoriesOf('doc');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [country, setCountry] = useState<Country>(initial?.country ?? 'CH');
  const [cat, setCat] = useState(initial?.categoryId ?? cats[1]?.id ?? cats[0]?.id);
  const [expiry, setExpiry] = useState<ISODate | ''>(initial?.expiryDate ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [keywords, setKeywords] = useState(initial?.keywords ?? '');
  const [file, setFile] = useState<Blob | null>(presetFile ?? null);
  const [fileName, setFileName] = useState(presetFile?.name ?? '');
  const [masked, setMasked] = useState(false);
  const [confirmClean, setConfirmClean] = useState(false);
  const [dropFile, setDropFile] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const sys = data.value.categories.find((c) => c.id === cat)?.system;
  const sensitiveCat = sys === 'bank' || sys === 'identity';
  const isImg = !!file && (file.type.startsWith('image/') || /\.(jpe?g|png|heic|webp|gif)$/i.test(fileName));
  const needsDecision = sensitiveCat && !!file && !masked && !confirmClean && !dropFile;

  useEffect(() => {
    if (!file || !isImg) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const pick = (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    setFile(f);
    setFileName(f.name);
    setMasked(false);
    setConfirmClean(false);
    setDropFile(false);
    if (!title) setTitle(f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 60));
  };

  async function save() {
    setTried(true);
    if (!title.trim() || needsDecision || busy) return;
    setBusy(true);
    try {
      const base: Doc = initial ?? { id: uid(), title: '', country, categoryId: cat, createdAt: nowStamp(), updatedAt: nowStamp() };
      const next: Doc = {
        ...base,
        title: maskSensitive(title.trim()).text,
        country,
        categoryId: cat,
        expiryDate: expiry || undefined,
        note: maskSensitive(note.trim()).text || undefined,
        keywords: maskSensitive(keywords.trim()).text || undefined,
      };
      if (file && !dropFile) {
        const rec = await saveFile(file, fileName || (isImg ? 'document.jpg' : 'document.pdf'));
        Object.assign(next, { fileId: rec.id, fileName: rec.name, mime: rec.mime, size: rec.size, masked: masked || undefined });
      }
      await saveDoc(next, isNew);
      close();
      if (isNew) go(`/documents/${next.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetBody
      foot={
        <button class="btn primary big" onClick={save} disabled={busy}>
          {isNew ? 'Ajouter au coffre' : 'Enregistrer'}
        </button>
      }
    >
      <div class="field">
        <span class="lab">Catégorie</span>
        <Chips value={cat} onChange={setCat} options={cats.map((c) => ({ value: c.id, label: c.name }))} />
      </div>

      {sys === 'bank' && (
        <div class="callout red">
          <b>Document bancaire :</b> relevés, RIB et cartes contiennent souvent des numéros de compte ou de carte. Ils ne doivent pas être stockés tels quels. Masquez-les avant l’ajout, ou ne conservez pas le fichier.
        </div>
      )}
      {sys === 'identity' && (
        <div class="callout red">
          <b>Pièce d’identité :</b> enregistrez son nom et sa date d’expiration, <b>pas son numéro</b>. Si vous joignez une photo, masquez le numéro et la bande de lecture en bas de page.
        </div>
      )}

      <div class="field">
        <span class="lab">Fichier {isNew ? '(facultatif)' : ''}</span>
        {file && !dropFile ? (
          <div class="card flat" style={{ padding: 10 }}>
            {preview && <img src={preview} alt="" style={{ width: '100%', borderRadius: 10, maxHeight: 220, objectFit: 'contain', background: 'var(--cream)' }} />}
            <div class="small row" style={{ marginTop: 6 }}>
              <span class="grow">
                {isImg ? 'Image' : 'PDF'} · {fmtSize(file.size)} {masked && <span class="pill ok">Masqué</span>}
              </span>
              <button class="link-btn" onClick={() => { setFile(null); setFileName(''); }}>
                Retirer
              </button>
            </div>
          </div>
        ) : (
          <div class="grid2">
            <label class="btn">
              <Camera size={20} /> Photo
              <input type="file" accept="image/*" capture="environment" class="sr-only" onChange={pick} />
            </label>
            <label class="btn">
              <ImagePlus size={20} /> Fichier / PDF
              <input type="file" accept="image/*,application/pdf" class="sr-only" onChange={pick} />
            </label>
          </div>
        )}
        {!isNew && initial?.fileId && !file && <span class="hint">Le fichier actuel est conservé. Choisissez-en un autre pour le remplacer.</span>}
      </div>

      {sensitiveCat && file && !dropFile && !masked && (
        <div class="card flat" style={{ borderColor: needsDecision && tried ? 'var(--danger)' : undefined }}>
          <div class="row" style={{ fontWeight: 700, color: 'var(--danger)' }}>
            <ShieldAlert size={20} /> Avant d’enregistrer
          </div>
          {isImg ? (
            <button class="btn primary block" style={{ marginTop: 10 }} onClick={() => openSheet('Masquer les numéros', (c) => <MaskEditor file={file} close={c} onDone={(b) => { setFile(b); setFileName('document-masque.jpg'); setMasked(true); }} />, { full: true })}>
              <EyeOff size={18} /> Masquer les numéros (recommandé)
            </button>
          ) : (
            <p class="small" style={{ margin: '8px 0' }}>
              Un PDF ne peut pas être masqué dans l’application. Astuce : faites une capture d’écran de la page utile, puis ajoutez-la comme image pour la masquer.
            </p>
          )}
          <label class="check">
            <input type="checkbox" checked={confirmClean} onChange={(e) => setConfirmClean((e.target as HTMLInputElement).checked)} />
            <span>Je confirme que ce fichier ne contient aucun numéro de compte, de carte, de passeport ou d’AVS (ou qu’ils sont déjà masqués).</span>
          </label>
          <button class="btn block ghost" onClick={() => setDropFile(true)}>
            Ne pas conserver le fichier (garder seulement la fiche)
          </button>
          {needsDecision && tried && <p class="error">Choisissez une option pour continuer.</p>}
          <p class="tiny muted" style={{ margin: '6px 0 0' }}>L’application ne peut pas détecter de façon fiable les numéros présents dans une image ou un PDF.</p>
        </div>
      )}
      {dropFile && (
        <div class="callout">
          Le fichier ne sera pas conservé.{' '}
          <button class="link-btn" onClick={() => setDropFile(false)}>
            Annuler ce choix
          </button>
        </div>
      )}

      <Field label="Titre" error={tried && !title.trim() ? 'Donnez un titre clair au document.' : null}>
        <input class="input" value={title} placeholder="Ex. Contrat assurance ménage 2026" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
      </Field>
      <SensitiveWarning text={title} />
      <div class="field">
        <span class="lab">Pays</span>
        <Seg value={country} onChange={setCountry} options={[{ value: 'CH', label: 'Suisse' }, { value: 'MA', label: 'Maroc' }, { value: 'both', label: 'Les deux' }]} />
      </div>
      <Field label="Date d’expiration (facultative)" hint={expiry ? 'Une échéance « Fin de validité » liée sera créée ou mise à jour automatiquement.' : 'Ex. passeport, permis, carte d’assurance, garantie.'}>
        <DateInput value={expiry} onChange={setExpiry} allowEmpty />
      </Field>
      {expiry && (
        <button class="link-btn" onClick={() => setExpiry('')}>
          Retirer la date d’expiration
        </button>
      )}
      <Field label="Mots-clés (facultatifs)">
        <input class="input" value={keywords} placeholder="Ex. ménage, AXA, 2026" onInput={(e) => setKeywords((e.target as HTMLInputElement).value)} />
      </Field>
      <Field label="Note (facultative)">
        <textarea class="input" value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
      </Field>
      <SensitiveWarning text={`${note} ${keywords}`} />
    </SheetBody>
  );
}

export function openDocForm(initial?: Doc, presetFile?: File) {
  openSheet(initial ? 'Modifier le document' : 'Nouveau document', (close) => <DocForm initial={initial} close={close} presetFile={presetFile} />);
}

// ---------- Sélecteurs de liens ----------

/** Depuis une dépense ou une échéance : choisir les documents liés. */
export function DocPicker({ target, close }: { target: { kind: 'tx' | 'deadline'; id: string }; close: () => void }) {
  const [q, setQ] = useState('');
  const owner = target.kind === 'tx' ? data.value.txs.find((t) => t.id === target.id) : data.value.deadlines.find((d) => d.id === target.id);
  const linked = new Set(owner?.docIds ?? []);
  const docs = alive(data.value.docs)
    .filter((d) => docMatches(d, q))
    .sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)) || b.createdAt.localeCompare(a.createdAt));
  return (
    <SheetBody
      foot={
        <button class="btn primary" onClick={close}>
          Terminé
        </button>
      }
    >
      <SearchBox value={q} onChange={setQ} placeholder="Rechercher un document" />
      <div class="list" style={{ marginTop: 10 }}>
        {docs.map((d) => (
          <label class="item">
            <input type="checkbox" style={{ width: 22, height: 22, accentColor: 'var(--bordeaux)' }} checked={linked.has(d.id)} onChange={(e) => linkDoc(d.id, target, (e.target as HTMLInputElement).checked)} />
            <div class="main">
              <div class="title">{d.title}</div>
              <div class="meta">{catName(d.categoryId)}</div>
            </div>
          </label>
        ))}
        {!docs.length && <div class="item muted small">Aucun document. Ajoutez-en avec le bouton +.</div>}
      </div>
    </SheetBody>
  );
}

/** Depuis un document : choisir les dépenses ou échéances liées. */
function LinkPicker({ docId, close }: { docId: string; close: () => void }) {
  const [tab, setTab] = useState<'tx' | 'deadline'>('deadline');
  const [q, setQ] = useState('');
  const nq = normalize(q);
  const deadlines = alive(data.value.deadlines)
    .filter((d) => !nq || normalize(d.title).includes(nq))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 60);
  const txs = alive(data.value.txs)
    .filter((t) => !nq || normalize(t.label).includes(nq))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 60);
  return (
    <SheetBody
      foot={
        <button class="btn primary" onClick={close}>
          Terminé
        </button>
      }
    >
      <Seg value={tab} onChange={setTab} options={[{ value: 'deadline', label: 'Échéances' }, { value: 'tx', label: 'Dépenses' }]} />
      <div style={{ marginTop: 10 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Rechercher" />
      </div>
      <div class="list" style={{ marginTop: 10 }}>
        {tab === 'deadline'
          ? deadlines.map((d) => (
              <label class="item">
                <input type="checkbox" style={{ width: 22, height: 22, accentColor: 'var(--bordeaux)' }} checked={d.docIds.includes(docId)} onChange={(e) => linkDoc(docId, { kind: 'deadline', id: d.id }, (e.target as HTMLInputElement).checked)} />
                <div class="main">
                  <div class="title">{d.title}</div>
                  <div class="meta">{fmtDate(d.date)}</div>
                </div>
              </label>
            ))
          : txs.map((t) => (
              <label class="item">
                <input type="checkbox" style={{ width: 22, height: 22, accentColor: 'var(--bordeaux)' }} checked={t.docIds.includes(docId)} onChange={(e) => linkDoc(docId, { kind: 'tx', id: t.id }, (e.target as HTMLInputElement).checked)} />
                <div class="main">
                  <div class="title">{t.label}</div>
                  <div class="meta">{fmtDate(t.date)}</div>
                </div>
                <Money cents={t.amount} cur={t.currency} />
              </label>
            ))}
      </div>
    </SheetBody>
  );
}

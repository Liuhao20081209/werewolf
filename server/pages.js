const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GITHUB_REPO = 'https://github.com/Liuhao20081209/werewolf';

module.exports = function registerPages(app, options) {
    const ROOT = options.root;
    const VERSION = options.version;
    const WOLF_FILE = options.wolfFile;

const OLD_SRC_DIR = path.join(ROOT, 'old');
function oldSourceFiles() {
    try {
        return fs.readdirSync(OLD_SRC_DIR)
            .filter(function (f) { return /^[A-Za-z0-9._-]+\.(js|zip)$/.test(f); })
            .sort(function (a, b) { return b.localeCompare(a, 'zh-CN', { numeric: true }); });
    } catch (e) { return []; }
}

function htmlSafe(t) {
    return String(t).replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
}

app.use('/assets', express.static(path.join(ROOT, 'assets')));

app.get('/download/wolf.js', (req, res) => {
    res.download(WOLF_FILE, 'wolf.js');
});

app.get('/download/source.zip', (req, res) => {
    const file = path.join(ROOT, 'source', 'wolf-source.zip');
    if (!fs.existsSync(file)) return res.status(404).send('源码包不存在，请先生成 source/wolf-source.zip');
    res.download(file, 'wolf-source.zip');
});

app.get('/old/:file', (req, res) => {
    const f = String(req.params.file || '');
    if (!/^[A-Za-z0-9._-]+\.(js|zip)$/.test(f)) return res.status(404).end();
    const full = path.join(OLD_SRC_DIR, f);
    if (!fs.existsSync(full)) return res.status(404).end();
    res.download(full, f);
});

function mdInline(text) {
    let t = htmlSafe(text);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, url) {
        const raw = url.replace(/&amp;/g, '&');
        if (!/^(https?:\/\/|\/|assets\/)/.test(raw)) return alt;
        return '<img src="' + htmlSafe(raw) + '" alt="' + alt + '" loading="lazy">';
    });
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
        const raw = url.replace(/&amp;/g, '&');
        if (!/^(https?:\/\/|mailto:|#|\/)/.test(raw)) return label;
        const ext = raw.indexOf('http') === 0 ? ' target="_blank" rel="noopener"' : '';
        return '<a href="' + htmlSafe(raw) + '"' + ext + '>' + label + '</a>';
    });
    return t;
}

function renderMarkdown(md) {
    const lines = String(md || '').split(/\r?\n/);
    let html = '';
    let list = '';
    let code = null;
    const closeList = function () {
        if (list) { html += '</' + list + '>'; list = ''; }
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const t = line.trim();
        if (code !== null) {
            if (/^```/.test(t)) {
                html += '<pre><code>' + htmlSafe(code.join('\n')) + '</code></pre>';
                code = null;
            } else {
                code.push(line);
            }
            continue;
        }
        if (t.indexOf('```') === 0) { closeList(); code = []; continue; }
        if (!t) { closeList(); continue; }
        if (/^#{1,4}\s+/.test(t)) {
            closeList();
            const level = t.match(/^#+/)[0].length;
            html += '<h' + level + '>' + mdInline(t.replace(/^#+\s+/, '')) + '</h' + level + '>';
            continue;
        }
        if (t.charAt(0) === '|' && i + 1 < lines.length) {
            const sep = lines[i + 1].trim();
            if (/^\|?[\s:|-]+\|?$/.test(sep) && sep.indexOf('-') >= 0) {
                closeList();
                const cells = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());
                const head = cells(line);
                i += 2;
                const rows = [];
                while (i < lines.length && lines[i].trim().charAt(0) === '|') {
                    rows.push(cells(lines[i]));
                    i++;
                }
                i--;
                html += '<table class="md-table"><thead><tr>' + head.map(x => '<th>' + mdInline(x) + '</th>').join('') + '</tr></thead><tbody>';
                rows.forEach(r => {
                    html += '<tr>' + head.map((_, k) => '<td>' + mdInline(r[k] || '') + '</td>').join('') + '</tr>';
                });
                html += '</tbody></table>';
                continue;
            }
        }
        if (/^---+$/.test(t)) { closeList(); html += '<hr>'; continue; }
        if (/^>\s?/.test(t)) { closeList(); html += '<blockquote>' + mdInline(t.replace(/^>\s?/, '')) + '</blockquote>'; continue; }
        if (/^[-*]\s+/.test(t)) {
            if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
            html += '<li>' + mdInline(t.replace(/^[-*]\s+/, '')) + '</li>';
            continue;
        }
        if (/^\d+\.\s+/.test(t)) {
            if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
            html += '<li>' + mdInline(t.replace(/^\d+\.\s+/, '')) + '</li>';
            continue;
        }
        closeList();
        html += '<p>' + mdInline(t) + '</p>';
    }
    if (code !== null) html += '<pre><code>' + htmlSafe(code.join('\n')) + '</code></pre>';
    closeList();
    return html;
}

const INDEX_HASH_CACHE = new Map();

function indexTime(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function indexHash(full) {
    try {
        const st = fs.statSync(full);
        const old = INDEX_HASH_CACHE.get(full);
        if (old && old.mtimeMs === st.mtimeMs && old.size === st.size) return old.hash;
        const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        INDEX_HASH_CACHE.set(full, { mtimeMs: st.mtimeMs, size: st.size, hash });
        return hash;
    } catch (e) { return 'N/A'; }
}

function indexSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    return (bytes / 1024).toFixed(1) + ' KB';
}

function indexMeta(full, isDir) {
    try {
        const st = fs.statSync(full);
        return {
            date: indexTime(st.mtime),
            size: isDir ? '—' : indexSize(st.size),
            hash: isDir ? '—' : indexHash(full)
        };
    } catch (e) { return { date: '—', size: '—', hash: '—' }; }
}

function indexRow(name, href, full, isDir) {
    const meta = indexMeta(full, isDir);
    return '<tr><td><div class="n"><i class="i ' + (isDir ? 'd' : 'f') + '"></i>'
        + '<a href="' + htmlSafe(href) + '">' + htmlSafe(name) + '</a></div></td>'
        + '<td class="m">' + meta.date + '</td>'
        + '<td class="m">' + meta.size + '</td>'
        + '<td class="h">' + meta.hash + '</td></tr>';
}

function indexPage(title, rows, parentHref) {
    const parent = parentHref
        ? '<tr><td><div class="n"><i class="i d"></i><a href="' + htmlSafe(parentHref) + '">../</a></div></td>'
          + '<td class="m">—</td><td class="m">—</td><td class="h">—</td></tr>'
        : '';
    const bodyRows = parent + rows;
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlSafe(title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;border-radius:0}
body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:#fff;color:#111;padding:2.5rem 1.5rem}
.w{max-width:1280px;margin:0 auto}
.head{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding-bottom:.6rem;border-bottom:1px solid #ddd;margin-bottom:1.5rem}
.head h1{font-size:1.5rem;font-weight:500;padding:0;border:0;margin:0}
.gh{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 10px;border:1px solid #c4c8cc;background:#fff;color:#333;text-decoration:none;font-size:12px;white-space:nowrap;flex:0 0 auto}
.gh:hover{border-color:#06c;color:#06c}
.gh img{width:18px;height:18px;display:block}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:.7rem .9rem;color:#555;font-weight:500;font-size:.8rem;letter-spacing:.04em;border-bottom:1px solid #ddd;white-space:nowrap}
td{padding:.75rem .9rem;border-bottom:1px solid #eee;vertical-align:middle}
tr:hover td{background:#fafafa}
a{color:#111;text-decoration:none}a:hover{color:#06c}
.n{display:flex;align-items:center}
.m,.h{color:#666;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem}
.m{white-space:nowrap}
.h{font-size:.75rem;color:#888;word-break:break-all;max-width:280px}
.i{display:inline-block;width:18px;height:18px;margin-right:10px;position:relative;flex-shrink:0}
.d::before{content:"";position:absolute;left:0;top:6px;width:18px;height:11px;background:#f2c200}
.d::after{content:"";position:absolute;left:0;top:2px;width:9px;height:6px;background:#f2c200}
.f::before{content:"";position:absolute;left:3px;top:1px;width:12px;height:16px;background:#9aa0a6;
  clip-path:polygon(0 0,70% 0,100% 25%,100% 100%,0 100%)}
.f::after{content:"";position:absolute;left:5px;top:8px;width:8px;height:1px;background:#fff;
  box-shadow:0 3px 0 #fff,0 6px 0 #fff}
.foot{margin-top:1.2rem;color:#999;font-size:.75rem}
.tip{margin:-6px 0 14px;font-size:12px}.tip a{color:#06c;text-decoration:none}.tip a:hover{text-decoration:underline}
@media(max-width:700px){body{padding:1.5rem 1rem}h1{font-size:1.3rem}th,td{padding:.6rem .35rem}.h,th:nth-child(4){display:none}.n a{word-break:break-all}.gh{height:30px;padding:0 8px;font-size:11px}.gh img{width:16px;height:16px}}
</style></head><body><div class="w">
<div class="head"><h1>${htmlSafe(title)}</h1><a class="gh" href="${GITHUB_REPO}" target="_blank" rel="noopener" title="打开 GitHub 仓库，查看详细部署步骤"><img src="/assets/github.svg" alt="GitHub"><span>去 GitHub 查看详细信息</span></a></div>
<p class="tip"><a href="/deploy">查看部署说明</a></p>
<table><thead><tr><th>名称</th><th>修改时间</th><th>大小</th><th>SHA-256</th></tr></thead>
<tbody>${bodyRows}</tbody></table>
</div></body></html>`;
}

app.get(['/download', '/download/'], (req, res) => {
    const sourceFile = path.join(ROOT, 'source', 'wolf-source.zip');
    const rows = [
        indexRow('old/', '/old', OLD_SRC_DIR, true),
        indexRow('README.md', '/deploy', path.join(ROOT, 'README.md'), false)
    ].concat(fs.existsSync(sourceFile)
        ? [indexRow('wolf-source.zip', '/download/source.zip', sourceFile, false)]
        : []).concat([
        indexRow('wolf.js', '/download/wolf.js', WOLF_FILE, false)
    ]).join('');
    res.set('Cache-Control', 'no-store');
    res.type('html').send(indexPage('Index of/', rows));
});

app.get(['/old', '/old/'], (req, res) => {
    const files = oldSourceFiles();
    const rows = files.length ? files.map(function (f) {
        return indexRow(f, '/old/' + encodeURIComponent(f), path.join(OLD_SRC_DIR, f), false);
    }).join('') : '';
    const empty = rows ? rows : '<tr><td colspan="4" class="m">old/ 目录里还没有历史版本</td></tr>';
    res.set('Cache-Control', 'no-store');
    res.type('html').send(indexPage('Index of/old/', empty, '/download'));
});

app.get('/deploy', (req, res) => {
    let readme = '';
    try { readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'); }
    catch (e) { readme = '# 狼人杀\n\nREADME.md 还没有生成'; }
    const body = renderMarkdown(readme);
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>狼人杀服务端源码与部署</title>
<style>
:root{--bg:#ececea;--surface:#fbfbfa;--text:#1c2a23;--sub:#56635b;--dim:#8a938c;--accent:#2f5a46;--line:rgba(92,118,99,.30)}
*{box-sizing:border-box;border-radius:0}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.75}
.wrap{width:100%;max-width:820px;margin:0 auto;padding:22px 18px 48px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.kicker{font-size:11px;letter-spacing:2px;color:var(--dim);margin:0 0 4px}
.gh{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 12px;border:1px solid var(--line);background:var(--surface);color:var(--sub);text-decoration:none;font-size:12px;white-space:nowrap}
.gh:hover{color:var(--accent);border-color:var(--accent)}
.gh img{width:20px;height:20px;display:block}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}
.btn{display:inline-flex;align-items:center;justify-content:center;padding:11px 15px;border:1px solid var(--accent);background:var(--accent);color:#f7f8f5;text-decoration:none;font-size:13px}
.btn.ghost{background:#edf3ee;color:var(--accent);border-color:var(--line)}
.md{background:var(--surface);border:1px solid var(--line);padding:26px 24px 28px}
.md h1{font-size:26px;line-height:1.35;margin:0 0 14px;letter-spacing:.01em}
.md h2{font-size:18px;margin:30px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--line)}
.md h3{font-size:15px;margin:22px 0 8px}
.md h4{font-size:14px;margin:18px 0 6px}
.md p{margin:0 0 12px;color:var(--sub)}
.md li{margin:0 0 7px;color:var(--sub)}
.md ul,.md ol{margin:0 0 14px;padding-left:22px}
.md a{color:var(--accent);text-decoration:none;border-bottom:1px solid rgba(47,90,70,.35)}
.md a:hover{border-bottom-color:var(--accent)}
.md code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;background:#edf2ee;border:1px solid rgba(92,118,99,.22);padding:1px 5px}
.md pre{margin:10px 0 16px;padding:14px;background:#eef3ef;border:1px solid rgba(92,118,99,.24);overflow-x:auto;line-height:1.8}
.md pre code{background:none;border:0;padding:0;font-size:12.5px}
.md blockquote{margin:0 0 14px;padding:10px 12px;border-left:3px solid var(--accent);background:#edf3ee;color:var(--sub)}
.md img{display:block;width:100%;max-width:360px;height:auto;margin:12px auto 18px;border:1px solid var(--line);background:#fff}
.md table{width:100%;border-collapse:collapse;margin:10px 0 18px;font-size:13px}
.md th,.md td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
.md th{background:#edf3ee;color:var(--text);font-weight:600}
.md tr:nth-child(even) td{background:#f7f9f7}
.md hr{border:0;border-top:1px solid var(--line);margin:24px 0}
.foot{margin-top:18px;color:var(--dim);font-size:12px;text-align:center}
@media(max-width:560px){.wrap{padding:16px 12px 36px}.md{padding:20px 16px 22px}.md h1{font-size:21px}.md h2{font-size:16px}.btn{flex:1 1 auto}.actions{gap:7px}.gh{height:34px;padding:0 9px;font-size:11px}.gh img{width:18px;height:18px}}
</style></head><body><div class="wrap">
<div class="top"><p class="kicker">WEREWOLF / NODE</p><a class="gh" href="${GITHUB_REPO}" target="_blank" rel="noopener" title="打开 GitHub 仓库，查看详细部署步骤"><img src="/assets/github.svg" alt="GitHub"><span>去 GitHub 查看详细信息</span></a></div>
<div class="actions"><a class="btn" href="/download/wolf.js" download>下载服务端源码</a><a class="btn ghost" href="/old">历史版本</a></div>
<article class="md">${body}</article>
<p class="foot">狼人杀 ${VERSION} 服务端源码与部署</p>
</div></body></html>`;
    res.type('html').send(html);
});

};


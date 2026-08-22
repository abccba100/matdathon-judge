/*
 * 맞다톤 전광판
 *
 * 데이터 출처는 공개 GitHub 이슈다. 심사 워크플로가 결과 코멘트 끝에
 * <!-- MATDATHON_JUDGEMENT {...} --> 형태로 기계 판독용 JSON 을 심어두므로,
 * 토큰 없이 공개 REST API 만으로 점수를 그대로 복원할 수 있다.
 */
(function () {
  'use strict';

  var CFG = window.MATDATHON_CONFIG || {};
  var API = 'https://api.github.com/repos/' + CFG.owner + '/' + CFG.repo;
  var MARKER = /<!--\s*MATDATHON_JUDGEMENT\s*([\s\S]*?)\s*-->/;

  var els = {
    body: document.getElementById('board-body'),
    error: document.getElementById('board-error'),
    dot: document.getElementById('conn-dot'),
    text: document.getElementById('conn-text'),
  };

  var openRows = {};   // 펼쳐 둔 행은 새로고침 후에도 유지한다.
  var cache = {};      // issueNumber -> judgement

  /* ------------------------------------------------------------------ */
  /* 유틸                                                                */
  /* ------------------------------------------------------------------ */

  // 사용자 콘텐츠는 전부 텍스트 노드로만 넣는다(XSS 차단).
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function timeOf(iso) {
    if (!iso) return '–';
    var d = new Date(iso);
    if (isNaN(d)) return '–';
    return d.toLocaleTimeString('ko-KR', { hour12: false });
  }

  function setConn(ok, message) {
    els.dot.className = 'conn-dot ' + (ok ? 'conn-up' : 'conn-down');
    els.text.textContent = ok ? 'LIVE' : 'OFFLINE';
    if (message) {
      els.error.textContent = message;
      els.error.hidden = false;
    } else {
      els.error.hidden = true;
    }
  }

  function labels(issue) {
    return (issue.labels || []).map(function (l) {
      return typeof l === 'string' ? l : l.name;
    });
  }

  /* ------------------------------------------------------------------ */
  /* 이슈 본문 파싱 — 이슈 양식의 ### 섹션에서 값을 꺼낸다                */
  /* ------------------------------------------------------------------ */

  function section(body, heading) {
    var lines = (body || '').replace(/\r\n/g, '\n').split('\n');
    var out = [];
    var capturing = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^###\s+/.test(line)) {
        if (capturing) break;
        capturing = line.replace(/^###\s+/, '').trim() === heading;
        continue;
      }
      if (capturing) out.push(line);
    }
    var value = out.join('\n').trim();
    return value.toLowerCase() === '_no response_' ? '' : value;
  }

  function appTitleOf(issue) {
    return section(issue.body, '앱 제목') ||
      (issue.title || '').replace(/^\s*\[submit\]\s*/i, '').trim() ||
      '(제목 없음)';
  }

  /* ------------------------------------------------------------------ */
  /* 데이터 로드                                                          */
  /* ------------------------------------------------------------------ */

  function getJSON(url) {
    return fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (res) {
        if (res.status === 403) throw new Error('GitHub API 요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요.');
        if (!res.ok) throw new Error('GitHub API 오류 (HTTP ' + res.status + ')');
        return res.json();
      });
  }

  function loadSubmissions() {
    return getJSON(API + '/issues?state=all&labels=submission&per_page=100&sort=created&direction=desc');
  }

  function cacheKey(issue) {
    return issue.number + '@' + (issue.updated_at || '');
  }

  // 결과 코멘트에 심어둔 JSON 을 되읽는다. 실패하면 null.
  // 재심사로 이슈가 갱신되면 캐시가 자동으로 무효화되도록 updated_at 을 키에 포함한다.
  function loadJudgement(issue) {
    var number = issue.number;
    var key = cacheKey(issue);
    if (cache[key] !== undefined) return Promise.resolve(cache[key]);
    return getJSON(API + '/issues/' + number + '/comments?per_page=100')
      .then(function (comments) {
        var found = null;
        for (var i = comments.length - 1; i >= 0; i--) {
          var m = MARKER.exec(comments[i].body || '');
          if (m) {
            try { found = JSON.parse(m[1]); } catch (e) { found = null; }
            if (found) break;
          }
        }
        cache[key] = found;
        return found;
      })
      .catch(function () { return null; });
  }

  /* ------------------------------------------------------------------ */
  /* 상태 판정                                                            */
  /* ------------------------------------------------------------------ */

  function statusOf(issue) {
    var ls = labels(issue);
    if (ls.indexOf('invalid') !== -1) return { key: 'fail', cls: 'badge-fail', glyph: '⚠', text: 'rejected' };
    if (ls.indexOf('needs-review') !== -1) return { key: 'review', cls: 'badge-fail', glyph: '⚠', text: 'needs review' };
    if (ls.indexOf('judged') !== -1) return { key: 'done', cls: 'badge-done', glyph: '✓', text: 'evaluated' };
    return { key: 'eval', cls: 'badge-eval', glyph: null, text: 'evaluating' };
  }

  /* ------------------------------------------------------------------ */
  /* 렌더링 — 목록                                                        */
  /* ------------------------------------------------------------------ */

  function render(issues) {
    els.body.textContent = '';

    if (!issues.length) {
      var tr = el('tr');
      tr.appendChild(el('td', 'board-empty', '아직 제출된 결과가 없습니다.'));
      tr.firstChild.colSpan = 7;
      els.body.appendChild(tr);
      return;
    }

    // 같은 제출자의 여러 제출은 시도 횟수로 묶고, 가장 최근 것만 순위에 올린다.
    var byAuthor = {};
    issues.forEach(function (issue) {
      var who = (issue.user && issue.user.login) || 'unknown';
      if (!byAuthor[who]) byAuthor[who] = [];
      byAuthor[who].push(issue);
    });

    var entries = Object.keys(byAuthor).map(function (who) {
      var list = byAuthor[who].slice().sort(function (a, b) {
        return new Date(b.created_at) - new Date(a.created_at);
      });
      return { author: who, latest: list[0], attempts: list.length };
    });

    // 점수 내림차순. 아직 점수가 없으면 뒤로 보낸다.
    entries.sort(function (a, b) {
      var sa = cache[a.latest.number] ? cache[a.latest.number].totalScore : -1;
      var sb = cache[b.latest.number] ? cache[b.latest.number].totalScore : -1;
      if (sa !== sb) return sb - sa;
      return new Date(b.latest.created_at) - new Date(a.latest.created_at);
    });

    entries.forEach(function (entry, index) {
      els.body.appendChild(buildRow(entry, index + 1));
      if (openRows[entry.latest.number]) {
        els.body.appendChild(buildDetailRow(entry.latest.number));
      }
    });
  }

  function buildRow(entry, rank) {
    var issue = entry.latest;
    var st = statusOf(issue);
    var judgement = cache[cacheKey(issue)];

    var tr = el('tr', 'board-row' + (openRows[issue.number] ? ' is-open' : ''));
    tr.tabIndex = 0;
    tr.setAttribute('role', 'button');
    tr.setAttribute('aria-expanded', openRows[issue.number] ? 'true' : 'false');

    tr.appendChild(el('td', 'col-rank', rank));

    var team = el('td', 'col-team');
    team.appendChild(el('span', 'row-caret', '▶'));
    team.appendChild(document.createTextNode(entry.author));
    tr.appendChild(team);

    tr.appendChild(el('td', 'col-app', appTitleOf(issue)));
    tr.appendChild(el('td', 'col-attempts', entry.attempts));
    tr.appendChild(el('td', 'col-submitted', timeOf(issue.created_at)));

    var status = el('td', 'col-status');
    var badge = el('span', 'badge ' + st.cls);
    if (st.glyph) {
      var g = el('span', 'badge-glyph', st.glyph);
      g.setAttribute('aria-hidden', 'true');
      badge.appendChild(g);
    } else {
      badge.appendChild(el('span', 'spinner'));
    }
    badge.appendChild(document.createTextNode(' ' + st.text));
    status.appendChild(badge);
    tr.appendChild(status);

    tr.appendChild(el('td', 'col-score',
      judgement ? judgement.totalScore.toFixed(1) : '–'));

    function toggle() {
      if (openRows[issue.number]) {
        delete openRows[issue.number];
        refreshView();
      } else {
        openRows[issue.number] = true;
        loadJudgement(issue).then(refreshView);
        refreshView();
      }
    }

    tr.addEventListener('click', toggle);
    tr.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });

    return tr;
  }

  /* ------------------------------------------------------------------ */
  /* 렌더링 — 상세 (부족한 점 · 개선 방안)                                */
  /* ------------------------------------------------------------------ */

  function buildDetailRow(number) {
    var tr = el('tr', 'board-detail-row');
    var td = el('td');
    td.colSpan = 7;

    var j = cache[number];

    if (j === undefined) {
      td.appendChild(el('p', 'detail-loading', '심사 결과를 불러오는 중…'));
    } else if (j === null) {
      td.appendChild(el('p', 'detail-loading',
        '아직 심사 결과가 등록되지 않았습니다. 심사가 끝나면 이곳에 표시됩니다.'));
    } else {
      buildDetail(td, j, number);
    }

    tr.appendChild(td);
    return tr;
  }

  function buildDetail(td, j, number) {
    // 총평
    if (j.summary) {
      var box = el('div', 'detail-final');
      box.appendChild(el('span', 'detail-final-label', '총평'));
      box.appendChild(el('p', 'detail-final-text', j.summary));
      td.appendChild(box);
    }

    // 메타 정보
    var meta = el('p', 'detail-meta');
    meta.appendChild(el('span', null, '총점 ' + j.totalScore.toFixed(1) + ' / 100'));
    if (j.commitHash) meta.appendChild(el('span', null, '커밋 ' + j.commitHash.slice(0, 12)));
    if (j.deploymentUrl) {
      var a = el('a', null, '배포 URL');
      a.href = j.deploymentUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      meta.appendChild(a);
    }
    var issueLink = el('a', null, '이슈 #' + number);
    issueLink.href = 'https://github.com/' + CFG.owner + '/' + CFG.repo + '/issues/' + number;
    issueLink.target = '_blank';
    issueLink.rel = 'noopener noreferrer';
    meta.appendChild(issueLink);
    td.appendChild(meta);

    // 경고
    if (j.deploymentReachable === false) {
      td.appendChild(el('div', 'detail-warn',
        '배포 URL에 접근할 수 없어 평가가 불가능했습니다. 핵심 기능은 로그인 없이 ' +
        '공개 접근 가능해야 하며, 규정에 따라 모든 항목에 최저점이 적용되었습니다.'));
    }
    if (j.promptInjectionDetected) {
      td.appendChild(el('div', 'detail-warn',
        '제출물에서 프롬프트 인젝션 시도로 보이는 내용이 감지되어 해당 지시는 무시되었고, ' +
        '"책임 있는 AI, 보안 및 신뢰" 항목 채점에 반영되었습니다.'));
    }

    // 항목별 점수 — 잃은 점수가 큰 순으로 정렬해 부족한 곳을 먼저 보여준다.
    td.appendChild(el('h3', 'detail-section-title', '항목별 점수 · 부족한 점'));

    var scores = (j.scores || []).slice().sort(function (a, b) {
      return (b.weight - b.weightedScore) - (a.weight - a.weightedScore);
    });

    var grid = el('div', 'detail-grid');
    scores.forEach(function (s) {
      var lost = s.weight - s.weightedScore;
      var tone = s.score <= 2 ? 'is-weak' : (s.score === 3 ? 'is-mid' : 'is-good');

      var card = el('div', 'detail-card ' + tone);

      var head = el('div', 'detail-card-head');
      head.appendChild(el('span', 'detail-criteria', s.id + '. ' + s.criterion));
      head.appendChild(el('span', 'detail-score', s.score + '/5 · ' + s.weight + '%'));
      card.appendChild(head);

      var bar = el('div', 'detail-bar');
      var fill = el('span');
      fill.style.width = (s.score / 5 * 100) + '%';
      bar.appendChild(fill);
      card.appendChild(bar);

      card.appendChild(el('p', 'detail-report', s.rationale || '근거가 제공되지 않았습니다.'));

      if (lost >= 0.05) {
        card.appendChild(el('p', 'detail-loss',
          '이 항목에서 ' + lost.toFixed(1) + '점을 잃었습니다.'));
      }

      grid.appendChild(card);
    });
    td.appendChild(grid);

    // 강점 / 개선 방안
    var strengths = j.strengths || [];
    var improvements = j.improvements || [];

    if (strengths.length || improvements.length) {
      td.appendChild(el('h3', 'detail-section-title', '개선 방안'));
      var lists = el('div', 'detail-lists');

      if (improvements.length) {
        lists.appendChild(buildList('is-improve', '이렇게 개선하세요', improvements));
      }
      if (strengths.length) {
        lists.appendChild(buildList('is-strength', '잘한 점', strengths));
      }
      td.appendChild(lists);
    }
  }

  function buildList(cls, title, items) {
    var box = el('div', 'detail-list ' + cls);
    box.appendChild(el('h4', null, title));
    var ul = el('ul');
    items.forEach(function (item) { ul.appendChild(el('li', null, item)); });
    box.appendChild(ul);
    return box;
  }

  /* ------------------------------------------------------------------ */
  /* 갱신 루프                                                            */
  /* ------------------------------------------------------------------ */

  var lastIssues = [];

  function refreshView() { render(lastIssues); }

  function tick() {
    loadSubmissions()
      .then(function (issues) {
        lastIssues = issues.filter(function (i) { return !i.pull_request; });
        setConn(true, null);

        // 심사가 끝난 항목은 점수를 미리 받아 순위를 정확히 매긴다.
        var pending = lastIssues
          .filter(function (i) {
            return labels(i).indexOf('judged') !== -1 && cache[cacheKey(i)] === undefined;
          })
          .slice(0, 10)
          .map(function (i) { return loadJudgement(i); });

        if (pending.length) return Promise.all(pending).then(refreshView);
        refreshView();
      })
      .catch(function (err) {
        setConn(false, err.message);
        refreshView();
      });
  }

  if (!CFG.owner || !CFG.repo) {
    setConn(false, 'config.js 에 owner/repo 를 설정하세요.');
    return;
  }

  tick();
  if (CFG.refreshMs) setInterval(tick, CFG.refreshMs);
})();

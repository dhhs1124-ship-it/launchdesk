/* /account — "내 쇼핑몰" (Supabase stores 테이블 CRUD).

   이번 단계는 stores 테이블과 화면을 연결하는 것까지만 한다 — Cafe24/
   스마트스토어 등 실제 플랫폼 API 연동은 하지 않는다. 그래서 목록의
   "연결 상태"는 항상 고정 문구("API 연결 전")이고, connected_accounts는
   조회도 생성도 하지 않는다.

   이 파일은 launchdeskStore(store.js)의 STEP/도구 기록과는 완전히 별도로
   동작한다 — stores는 그 파일의 관심사가 아니고, debounce가 필요한
   데이터도 아니라서(버튼을 눌러야만 쓰기가 발생) 굳이 얹지 않았다. 대신
   로그인/로그아웃 타이밍은 launchdeskStore가 이미 정확히 판별해 쏴주는
   onChange 이벤트에 편승한다 — app.js의 handleSession()이 hydrate()/
   resetToGuest() 이후에만 그 이벤트를 울리므로, 이 파일이 그 시점에
   sb.auth.getSession()을 다시 물어보면 "지금 로그인된 사용자가 누구인지"를
   항상 최신 상태로 안전하게 알 수 있다.

   보안 원칙(요청사항 그대로):
   - user_id는 화면 입력값을 절대 신뢰하지 않는다 — 매 요청마다
     Supabase Auth 세션에서 막 확인한 currentUserId만 사용한다.
   - 모든 쓰기(update/delete)에 .eq('user_id', currentUserId)를 한 번 더
     걸어둔다 — RLS가 이미 막아주지만, 클라이언트 쪽에서도 실수로 다른
     사용자의 행을 건드리는 요청 자체를 만들지 않기 위한 이중 방어.
   - service_role/secret key/API token은 쓰지 않는다(publishable key +
     로그인 세션 + RLS만 사용). localStorage에 stores를 복제하지 않는다
     (아래 state는 메모리에만 있고, 새로고침하면 다시 서버에서 불러온다). */
(function(){
  var guestNotice = document.getElementById('storesGuestNotice');
  var panel = document.getElementById('storesPanel');
  var emptyEl = document.getElementById('storesEmpty');
  var listEl = document.getElementById('storesList');
  var addBtn = document.getElementById('storeAddBtn');
  if(!listEl || !panel){ return; } // view-account 마크업이 없으면(구버전 캐시 등) 조용히 종료

  var modal = document.getElementById('storeFormModal');
  var modalBackdrop = document.getElementById('storeFormBackdrop');
  var modalClose = document.getElementById('storeFormClose');
  var modalTitle = document.getElementById('storeFormTitle');
  var form = document.getElementById('storeForm');
  var submitBtn = document.getElementById('storeFormSubmit');
  var nameInput = document.getElementById('storeName');
  var platformSelect = document.getElementById('storePlatform');
  var urlInput = document.getElementById('storeUrl');

  // showToast: app.js/tools.js와 동일한 방식으로 이 파일 안에서 따로
  // 둔다(각자 다른 최상위 IIFE라 함수를 공유할 수 없음 — tools.js의 같은
  // 주석 참고).
  var toastStack = document.getElementById('toastStack');
  function showToast(message, type){
    if(!toastStack) return;
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = message;
    toastStack.appendChild(el);
    requestAnimationFrame(function(){ el.classList.add('show'); });
    setTimeout(function(){
      el.classList.remove('show');
      setTimeout(function(){ el.remove(); }, 250);
    }, 2600);
  }

  var PLATFORM_LABELS = { cafe24: 'Cafe24', smartstore: '스마트스토어', other: '기타' };
  function platformLabel(value){ return PLATFORM_LABELS[value] || value; }

  function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, function(ch){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }
  // store_url은 사용자가 자유 입력한 값이라, href에 그대로 꽂기 전에
  // http(s) 스킴인지만 확인한다(예: javascript: 등은 링크로 만들지 않고
  // 그냥 텍스트로만 보여준다).
  function safeHref(url){
    return /^https?:\/\//i.test(url || '') ? url : null;
  }

  function client(){ return window.launchdeskSupabase || null; }

  // ------------------------------------------------------------------ state
  var currentUserId = null;
  var stores = [];
  var editingId = null; // null = 추가 모드, 아니면 그 store id를 수정 중
  // hydrateFromSession()이 울릴 때마다 증가 — 응답이 늦게 와서 순서가
  // 뒤바뀌어도(예: A 로그아웃 직후 바로 B 로그인) 가장 마지막 요청의
  // 결과만 반영하기 위한 가드.
  var requestSeq = 0;

  function render(){
    var authed = !!currentUserId;
    guestNotice.hidden = authed;
    panel.hidden = !authed;
    if(!authed){
      listEl.innerHTML = ''; // 로그아웃 직후 DOM에 이전 사용자의 목록이 남아있지 않게 확실히 비운다
      return;
    }

    if(!stores.length){
      emptyEl.hidden = false;
      listEl.innerHTML = '';
      return;
    }
    emptyEl.hidden = true;
    listEl.innerHTML = stores.map(function(s){
      var href = safeHref(s.store_url);
      var urlHtml = href
        ? '<a class="store-url" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(s.store_url) + '</a>'
        : '<span class="store-url">' + escapeHtml(s.store_url) + '</span>';
      return (
        '<div class="store-card" data-id="' + escapeHtml(s.id) + '">' +
          '<div class="store-card-main">' +
            '<div class="store-card-head">' +
              '<span class="store-name">' + escapeHtml(s.name) + '</span>' +
              '<span class="store-platform-badge">' + escapeHtml(platformLabel(s.platform)) + '</span>' +
            '</div>' +
            urlHtml +
            '<div class="store-status">API 연결 전</div>' +
          '</div>' +
          '<div class="store-card-actions">' +
            '<button type="button" class="btn btn-ghost btn-sm store-edit-btn" data-id="' + escapeHtml(s.id) + '">수정</button>' +
            '<button type="button" class="btn btn-ghost btn-sm store-del-btn" data-id="' + escapeHtml(s.id) + '">삭제</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function fetchStores(userId, seq){
    var sb = client();
    if(!sb) return;
    sb.from('stores')
      .select('id, name, platform, store_url, is_active, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .then(function(res){
        if(seq !== requestSeq) return; // 그 사이 다른 사용자로 바뀌었으면 버림
        if(res.error){
          console.warn('[launchdesk] stores 조회 실패:', res.error.message);
          stores = [];
        } else {
          stores = res.data || [];
        }
        render();
      })
      .catch(function(err){
        if(seq !== requestSeq) return;
        console.warn('[launchdesk] stores 조회 중 오류:', err && err.message);
        stores = [];
        render();
      });
  }

  // launchdeskStore.onChange가 로그인/로그아웃 확정 시점에 울려주는 이벤트에
  // 편승해, 그 시점의 실제 Supabase 세션을 다시 확인한다 — 화면 입력이나
  // 다른 전역 변수가 아니라 세션 그 자체를 user_id의 유일한 출처로 쓴다.
  function hydrateFromSession(){
    var sb = client();
    requestSeq += 1;
    var seq = requestSeq;
    if(!sb){
      currentUserId = null;
      stores = [];
      render();
      return;
    }
    sb.auth.getSession().then(function(res){
      if(seq !== requestSeq) return;
      var session = res.data && res.data.session;
      var user = session && session.user;
      if(user){
        currentUserId = user.id;
        stores = []; // 새 사용자 몫을 불러오는 동안 이전 목록이 잠깐이라도 보이지 않게
        render();
        fetchStores(user.id, seq);
      } else {
        currentUserId = null;
        stores = [];
        render();
      }
    });
  }

  if(window.launchdeskStore){
    window.launchdeskStore.onChange(hydrateFromSession);
  }
  // 초기 렌더 — 아직 로그인 여부를 모르는 상태이므로 일단 비회원 화면으로
  // 그려두고, 위 onChange가 실제 세션 확인 후 다시 그린다(깜빡임 최소화를
  // 위해 launchdeskStore가 처음 hydrate/resetToGuest를 한 번은 반드시
  // 호출하므로 곧 정확한 상태로 갱신된다).
  render();

  // -------------------------------------------------------------- 모달 제어
  function openModal(mode, storeRow){
    editingId = mode === 'edit' ? storeRow.id : null;
    modalTitle.textContent = editingId ? '쇼핑몰 수정' : '쇼핑몰 추가';
    submitBtn.textContent = editingId ? '저장하기' : '추가하기';
    nameInput.value = editingId ? storeRow.name : '';
    platformSelect.value = editingId ? storeRow.platform : 'cafe24';
    urlInput.value = editingId ? storeRow.store_url : '';
    modal.classList.add('open');
    nameInput.focus();
  }
  function closeModal(){
    modal.classList.remove('open');
    form.reset();
    editingId = null;
  }
  if(addBtn) addBtn.addEventListener('click', function(){ openModal('add'); });
  if(modalClose) modalClose.addEventListener('click', closeModal);
  if(modalBackdrop) modalBackdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });

  // 목록의 수정/삭제 버튼 — 이벤트 위임(목록이 매번 innerHTML로 새로
  // 그려지므로, 각 버튼에 매번 리스너를 다는 대신 listEl 하나에만 건다).
  listEl.addEventListener('click', function(e){
    var editBtn = e.target.closest('.store-edit-btn');
    if(editBtn){
      var row = stores.filter(function(s){ return String(s.id) === editBtn.getAttribute('data-id'); })[0];
      if(row) openModal('edit', row);
      return;
    }
    var delBtn = e.target.closest('.store-del-btn');
    if(delBtn){
      var id = delBtn.getAttribute('data-id');
      var target = stores.filter(function(s){ return String(s.id) === id; })[0];
      var label = target ? target.name : '이 쇼핑몰';
      if(!window.confirm('"' + label + '"을(를) 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return;
      deleteStore(id);
    }
  });

  function deleteStore(id){
    var sb = client();
    if(!sb || !currentUserId) return;
    sb.from('stores').delete()
      .eq('id', id)
      .eq('user_id', currentUserId) // RLS로 이미 막히지만, 클라이언트에서도 스스로 범위를 좁혀둔다
      .then(function(res){
        if(res.error){
          showToast('삭제에 실패했어요: ' + res.error.message, 'error');
          return;
        }
        stores = stores.filter(function(s){ return String(s.id) !== String(id); });
        render();
        showToast('쇼핑몰을 삭제했어요');
      })
      .catch(function(err){
        showToast('삭제 중 오류가 발생했어요', 'error');
        console.warn('[launchdesk] store 삭제 중 오류:', err && err.message);
      });
  }

  form.addEventListener('submit', function(e){
    e.preventDefault();
    if(!currentUserId){ closeModal(); return; } // 세션이 그 사이 끊긴 경우의 방어
    var sb = client();
    if(!sb) return;

    var name = nameInput.value.trim();
    var platform = platformSelect.value;
    var storeUrl = urlInput.value.trim();
    if(!name || !storeUrl) return; // required 속성이 이미 막아주지만 한 번 더 방어

    submitBtn.disabled = true;

    if(editingId){
      // 수정: id/user_id/external_store_id는 절대 건드리지 않는다.
      sb.from('stores')
        .update({ name: name, platform: platform, store_url: storeUrl })
        .eq('id', editingId)
        .eq('user_id', currentUserId)
        .select('id, name, platform, store_url, is_active, created_at')
        .then(function(res){
          submitBtn.disabled = false;
          if(res.error || !res.data || !res.data.length){
            showToast('수정에 실패했어요' + (res.error ? ': ' + res.error.message : ''), 'error');
            return;
          }
          var updated = res.data[0];
          stores = stores.map(function(s){ return String(s.id) === String(updated.id) ? updated : s; });
          render();
          closeModal();
          showToast('쇼핑몰 정보를 수정했어요', 'success');
        })
        .catch(function(err){
          submitBtn.disabled = false;
          showToast('수정 중 오류가 발생했어요', 'error');
          console.warn('[launchdesk] store 수정 중 오류:', err && err.message);
        });
    } else {
      // 추가: user_id는 화면 입력이 아니라 이 시점의 currentUserId(로그인
      // 세션에서 확인한 값)만 사용한다. external_store_id는 이번 단계에서
      // 입력받지 않으므로 보내지 않고(DB default/NULL), is_active만 명시적
      // 으로 true를 준다.
      sb.from('stores')
        .insert({ user_id: currentUserId, name: name, platform: platform, store_url: storeUrl, is_active: true })
        .select('id, name, platform, store_url, is_active, created_at')
        .then(function(res){
          submitBtn.disabled = false;
          if(res.error || !res.data || !res.data.length){
            showToast('추가에 실패했어요' + (res.error ? ': ' + res.error.message : ''), 'error');
            return;
          }
          stores.unshift(res.data[0]);
          render();
          closeModal();
          showToast('쇼핑몰을 추가했어요', 'success');
        })
        .catch(function(err){
          submitBtn.disabled = false;
          showToast('추가 중 오류가 발생했어요', 'error');
          console.warn('[launchdesk] store 추가 중 오류:', err && err.message);
        });
    }
  });
})();

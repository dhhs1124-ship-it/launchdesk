/* #/admin > 택배사: DB 목록과 등록/수정/공개/삭제. 접근은 admin.js가
   확인하고, DB의 RLS 및 RPC가 매 호출마다 최종 권한을 확인한다. */
(function(){
  var REGIONS = [
    { value: 'seoul', label: '서울' },
    { value: 'gyeonggi', label: '경기' },
    { value: 'incheon', label: '인천' },
    { value: 'other', label: '기타' }
  ];
  function escapeHtml(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }
  function phoneText(phone){
    return String(phone || '').replace(/^(01\d)(\d{3,4})(\d{4})$/, '$1-$2-$3');
  }
  function render(container){
    var sb = window.launchdeskSupabase;
    var items = [];
    var editingId = null;
    container.innerHTML = '<div class="admin-panel-head">택배사 관리</div>' +
      '<div class="admin-panel-body admin-courier">' +
        '<p class="admin-courier-intro">공개 상태인 연락처만 택배 집하 상담 화면에 표시됩니다.</p>' +
        '<form id="adminCourierForm" class="admin-courier-form">' +
          '<h2 id="adminCourierFormTitle">택배사 등록</h2>' +
          '<div class="admin-courier-fields">' +
            '<label>택배사·담당자명<input name="name" maxlength="120" required placeholder="예: CJ대한통운 ○○대리점"></label>' +
            '<label>집하 가능 지역<input name="area_label" maxlength="160" required placeholder="예: 서울 금천구 가산동"></label>' +
            '<label>연락처<input name="phone" type="tel" inputmode="tel" required placeholder="010-0000-0000"></label>' +
          '</div>' +
          '<fieldset><legend>지역 필터 (해당하는 곳 모두 선택)</legend>' +
            REGIONS.map(function(r){ return '<label><input type="checkbox" name="regions" value="' + r.value + '"> ' + r.label + '</label>'; }).join('') +
          '</fieldset>' +
          '<label>상담 조건·설명<textarea name="description" maxlength="1000" rows="3" required placeholder="집하 가능 지역, 물량과 요금 조건 등을 적어주세요."></textarea></label>' +
          '<label class="admin-courier-published"><input type="checkbox" name="published" checked> 바로 공개</label>' +
          '<div class="admin-courier-actions"><button class="btn btn-primary btn-sm" type="submit" id="adminCourierSave">등록하기</button>' +
            '<button class="btn btn-ghost btn-sm" type="button" id="adminCourierCancel" hidden>수정 취소</button></div>' +
          '<p id="adminCourierMessage" role="status" aria-live="polite"></p>' +
        '</form>' +
        '<div class="admin-courier-list-head"><h2>등록된 연락처</h2><button class="btn btn-ghost btn-sm" type="button" id="adminCourierRefresh">새로고침</button></div>' +
        '<div id="adminCourierList" role="status">목록을 불러오는 중…</div>' +
      '</div>';
    var form = container.querySelector('#adminCourierForm');
    var list = container.querySelector('#adminCourierList');
    var message = container.querySelector('#adminCourierMessage');
    var submit = container.querySelector('#adminCourierSave');
    var sequence = 0;

    function active(){ return container.isConnected && container.querySelector('#adminCourierForm') === form; }
    function report(text){ message.textContent = text; }
    function reset(){
      editingId = null;
      form.reset();
      container.querySelector('#adminCourierFormTitle').textContent = '택배사 등록';
      submit.textContent = '등록하기';
      container.querySelector('#adminCourierCancel').hidden = true;
      report('');
    }
    function showList(){
      list.innerHTML = items.length ? items.map(function(row){
        return '<article class="admin-courier-row" data-id="' + escapeHtml(row.id) + '">' +
          '<div><strong>' + escapeHtml(row.name) + '</strong> <span>' + (row.published ? '공개' : '비공개') + '</span>' +
          '<p>' + escapeHtml(row.area_label) + ' · ' + escapeHtml(phoneText(row.phone)) + '</p>' +
          '<p>' + escapeHtml(row.description) + '</p></div>' +
          '<div class="admin-courier-row-actions">' +
            '<button class="btn btn-ghost btn-sm" type="button" data-action="edit">수정</button>' +
            '<button class="btn btn-ghost btn-sm" type="button" data-action="toggle">' + (row.published ? '비공개' : '공개') + '</button>' +
            '<button class="btn btn-ghost btn-sm" type="button" data-action="delete">삭제</button>' +
          '</div></article>';
      }).join('') : '등록된 연락처가 없습니다.';
    }
    function load(){
      if(!sb){ list.textContent = 'DB 연결을 확인해 주세요.'; return; }
      var seq = ++sequence;
      sb.from('courier_contacts').select('id, name, area_label, regions, description, phone, published')
        .order('created_at', { ascending: true }).then(function(result){
          if(!active() || seq !== sequence) return;
          if(result.error){ list.textContent = '목록을 불러오지 못했습니다. DB 마이그레이션 적용 상태를 확인해 주세요.'; return; }
          items = result.data || [];
          showList();
        }).catch(function(){ if(active()) list.textContent = '목록을 불러오지 못했습니다.'; });
    }
    function save(row, successText){
      submit.disabled = true;
      report('저장 중…');
      return sb.rpc('save_courier_contact', {
        p_id: row.id || null,
        p_name: row.name,
        p_area_label: row.area_label,
        p_regions: row.regions,
        p_description: row.description,
        p_phone: row.phone,
        p_published: row.published
      }).then(function(result){
        if(!active()) return;
        if(result.error){ report('저장에 실패했습니다. 입력값과 관리자 권한을 확인해 주세요.'); return; }
        reset();
        report(successText);
        load();
        window.dispatchEvent(new Event('launchdesk:couriers-changed'));
      }).catch(function(){ if(active()) report('연결 오류로 저장하지 못했습니다.'); })
        .finally(function(){ if(active()) submit.disabled = false; });
    }
    form.addEventListener('submit', function(event){
      event.preventDefault();
      if(!sb) return report('DB 연결을 확인해 주세요.');
      var regions = Array.prototype.slice.call(form.querySelectorAll('input[name="regions"]:checked')).map(function(el){ return el.value; });
      var phone = form.elements.phone.value.replace(/\D/g, '');
      if(!regions.length) return report('지역 필터를 하나 이상 선택해 주세요.');
      if(!/^01\d{8,9}$/.test(phone)) return report('휴대전화 번호를 확인해 주세요.');
      save({
        id: editingId,
        name: form.elements.name.value.trim(),
        area_label: form.elements.area_label.value.trim(),
        regions: regions,
        description: form.elements.description.value.trim(),
        phone: phone,
        published: form.elements.published.checked
      }, editingId ? '수정했습니다.' : '등록했습니다.');
    });
    container.querySelector('#adminCourierCancel').addEventListener('click', reset);
    container.querySelector('#adminCourierRefresh').addEventListener('click', load);
    list.addEventListener('click', function(event){
      var button = event.target.closest('button[data-action]');
      if(!button) return;
      var wrapper = button.closest('[data-id]');
      var row = items.filter(function(item){ return item.id === wrapper.getAttribute('data-id'); })[0];
      if(!row) return;
      var action = button.getAttribute('data-action');
      if(action === 'edit'){
        editingId = row.id;
        form.elements.name.value = row.name;
        form.elements.area_label.value = row.area_label;
        form.elements.phone.value = phoneText(row.phone);
        form.elements.description.value = row.description;
        form.elements.published.checked = row.published;
        Array.prototype.forEach.call(form.querySelectorAll('input[name="regions"]'), function(el){
          el.checked = row.regions.indexOf(el.value) !== -1;
        });
        container.querySelector('#adminCourierFormTitle').textContent = '택배사 수정';
        submit.textContent = '저장하기';
        container.querySelector('#adminCourierCancel').hidden = false;
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if(action === 'toggle'){
        save({ id: row.id, name: row.name, area_label: row.area_label, regions: row.regions,
          description: row.description, phone: row.phone, published: !row.published }, '공개 상태를 변경했습니다.');
      } else if(action === 'delete' && window.confirm(row.name + ' 연락처를 삭제할까요?')){
        button.disabled = true;
        sb.rpc('delete_courier_contact', { p_id: row.id }).then(function(result){
          if(!active()) return;
          if(result.error){ button.disabled = false; return report('삭제에 실패했습니다.'); }
          if(editingId === row.id) reset();
          report('삭제했습니다.');
          load();
          window.dispatchEvent(new Event('launchdesk:couriers-changed'));
        }).catch(function(){ if(active()){ button.disabled = false; report('연결 오류로 삭제하지 못했습니다.'); } });
      }
    });
    load();
  }
  window.launchdeskCourierAdmin = { render: render };
})();

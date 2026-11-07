// ASRYO editorial navigation. No third-party assets or tracking.
const toggle=document.getElementById('editorialMenuButton');
const menu=document.getElementById('editorialNav');

if(toggle&&menu){
  const setOpen=(open,returnFocus=false)=>{
    menu.classList.toggle('is-open',open);
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',open?'Close navigation':'Open navigation');
    if(returnFocus)toggle.focus();
  };
  toggle.addEventListener('click',()=>{
    const opening=toggle.getAttribute('aria-expanded')!=='true';
    setOpen(opening);
    if(opening)menu.querySelector('a')?.focus();
  });
  menu.addEventListener('click',event=>{
    if(event.target.closest('a'))setOpen(false);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true')setOpen(false,true);
  });
  document.addEventListener('click',event=>{
    if(toggle.getAttribute('aria-expanded')==='true'&&!menu.contains(event.target)&&!toggle.contains(event.target))setOpen(false);
  });
  window.addEventListener('resize',()=>{
    if(window.innerWidth>980&&toggle.getAttribute('aria-expanded')==='true')setOpen(false);
  });
}

<%@ Page Language="C#" AutoEventWireup="true"  CodeFile="../PhotoPage.cs" Inherits="_PhotoPage" MaintainScrollPositionOnPostback="true" %>

<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">

<html xmlns="https://www.w3.org/1999/xhtml" xmlns:fb="https://www.facebook.com/2008/fbml">

<head runat="server">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<title>{0} | davidconger.com | photography</title>
<link rel="stylesheet" href="../you.css" type="text/css" media="screen" />
<script type="text/javascript" src="../support.js"></script>
<script src="https://connect.facebook.net/en_US/all.js"></script>
</head>

<body style="color: #FFFFFF; background-color: #2A2A2A; font-family: Arial, Helvetica, sans-serif; text-align: center;">
<script runat="server">
    protected void Page_Load(object sender, EventArgs e)
    {
        System.Security.Cryptography.SHA256 sha = System.Security.Cryptography.SHA256.Create();
        byte[] checksum = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes("bumblebeetuna34"));
        if (BitConverter.ToString(checksum).Replace("-", String.Empty) != (string)Session["dc-you-private"])
        {
            Response.Redirect("error.htm");
        }
    }
</script>
<form runat=server>
    <p>&nbsp;</p>
    <p>&nbsp;</p>
    <p style="text-align:center;">
    <a href="https://davidconger.com/you/">
    <img src="https://davidconger.com/images/header.png" width="710" height="75" style="border-width: 0px" /></a></p>
    <p style="text-align: center; ">
    <span class="title-name">{0}</span><br />
    {1}<br/></p>
    <p style="text-align: center; ">
    <span class="instructions">Use the Login Button then click on an image to post it to your Facebook wall.</span><br/><br/>
    <span id="loginButtonText" style="color: #2A2A2A;"><fb:login-button onlogin="fbLoginReady();" perms="publish_stream">Login and Allow Photo Posting</fb:login-button></span></p>

{4}
    <p style="text-align: center; ">Acceptable use of the photos found here is ONLY posting to Facebook. Photos cannot be used for any other purpose and no rights are 
	transferred.</p>
    <asp:TextBox ID="txtMessage" runat="server" CssClass="hiddenField">{0}{2}</asp:TextBox>
    <asp:CheckBox ID="chkLoginReady" runat="server" Checked="false" CssClass="hiddenField" />

<div id="infoMessage" class="info" style="visibility: hidden; display: none;" onclick="this.setAttribute('style', 'visibility: hidden; display: none;');"></div>
<div id="successMessage" class="success" style="visibility: hidden; display: none;" onclick="this.setAttribute('style', 'visibility: hidden; display: none;');"></div>
<!--<div class="warning" style="visibility: hidden;"></div>-->
<div id="errorMessage" class="error" style="visibility: hidden; display: none;" onclick="this.setAttribute('style', 'visibility: hidden; display: none;');"></div>

</form>

<div id="fb-root" style="display: none"></div>
<script>
    FB.init({ appId: '114861015219263', status: true, cookie: true, xfbml: true });
    FB.Event.subscribe('auth.sessionChange', function(response) {
        if (response.session) {
            // A user has logged in, and a new cookie has been saved
        } else {
            // The user has logged out, and the cookie has been cleared
        }
    });
</script>
    
</body>
</html>
